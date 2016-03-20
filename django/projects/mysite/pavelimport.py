#!/usr/bin/env python
#
# Import ontology and classification from Pavel's database. The resulting
# CATMAID onrology will be similar to what is expressed as a database scheme
# there:
#
# Experiments

import json
import pymysql.cursors
import pymysql
import requests
import re, os, sys

from collections import defaultdict
from catmaid.models import (Class, ClassClass, ClassInstance,
        ClassInstanceClassInstance, Relation, Stack, ProjectStack,
        StackClassInstance)

requests.packages.urllib3.disable_warnings()

def log(msg, indent=0):
    print("  " * indent + msg)

class ExperimentStack(object):
    def __init__(self, title, image_base, res, dim):
        pass

class Experiment(object):
    def __init__(self, stacks=[]):
        self.stacks = stacks

stack_types = {
    'Channel 1': 'channel0',
    'Channel 2': 'channel1',
    'Composite': 'composite'
}

class CatmaidExperimentProvider(object):

    def __init__(self):
        self.project_stack_info = self.get_project_mapping_file()

    def get_project_mapping_rest():
        dot_projects = requests.get('http://bds.mpi-cbg.de/catmaid/projects',
            verify=False).json()
        project_stack_info = {}
        for n, p in enumerate(dot_projects):
            p_title = p['title']
            properties = {}
            project_stack_info[p_title] = properties
            # This has changed in recent version (luckily):
            stacks = dot_projects[0]['action'][0]['action']
            stack_ids = stacks.keys()
            if not stack_ids:
                log('Did not find any stack ids for project %s (%s)' % (p, p_title))
                continue
            for sid in stack_ids:
                stack = stacks[sid]
                stack_type = stack_types.get(stack['title'], None)
                if not stack_type:
                    log('Couldn\'t find stack type for stack % in project %s (%)' %
                        (sid, p, p_title))
                    continue
                url = 'https://bds.mpi-cbg.de/catmaid/{0}/stack/{1}/info'.format(
                        p['pid'], sid)
                log("Requesting {0}/{1}: {2}".format(n+1, len(dot_projects), url))
                stack_info = requests.get(url, verify=False).json()
                image_base = stack_info.get('image_base', None)
                if not (image_base):
                    continue
                properties[stack_type] = stack_info
                log("{}: {}".format(stack_type, image_base), 1)

        return project_stack_info

class JsonExperimentProvider(object):

    def __init__(self, path):
        # Request project mapping from
        # https://bds.mpi-cbg.de/catmaid/projects
        log("Requesting montage information")
        self.dot_projects = self.get_project_mapping_file(path)
        log("Done preparing montage information")

    def get_project_mapping_file(self, path):
        """Reads JSON file that is generated with:

        echo "copy (select row_to_json(t) from (
                select p.id as pid, p.title as ptitle, s.*
                from project p
                join taggit_taggeditem t on p.id=t.object_id
                join taggit_tag tt on t.tag_id=tt.id
                join project_stack ps on p.id=ps.project_id
                join stack s on s.id=ps.stack_id
                where t.content_type_id=44
        ) t) to stdout;" | sudo -u postgres psql -d bds_catmaid > dot_project_stacks.json
        """
        with open(path) as f:
            json_data = json.load(f)

        project_stack_info = defaultdict(list)
        for row in json_data:
            project_stack_info[row['ptitle']].append(row)

        return project_stack_info   

class ArrangementExperimentProvider(object):

    def __init__(self, base_path):
        self.base_path = base_path

    def get_dimensions(self, plate, pos):
        arrangement_file = None
        try:
            arrangement_path = os.path.join(self.base_path,
                                           "{}_{}".format(plate, pos),
                                           "arrangement.txt")
            arrangement_file = open(arrangement_path, 'r')
            arrangement = arrangement_file.read()
        except IOError, e:
            return None
        finally:
            if arrangement_file:
                arrangement_file.close()
    
        # Find last tile
        tiles = re.findall("^(\d+),(\d+),(\d+),(\d+),(\d+),(\d+[.][\d+]),"
            "(\d+[.][\d+]),([^,]+)(.*)]", arrangement, re.M)
        if not tiles:
            raise ValueError("Couldn't find tiles to read dimension "
            " information for plate {} pos {}".format(plate, pos))
        last_tile =tiles[-1]

        # Add the last tile's width and height to its position to get he
        # dimensions of this image stack
        width = float(last_tile[2])
        height = float(last_tile[3])
        depth = float(last_tile[4])
        x = float(last_tile[5])
        y = float(last_tile[6])

        return {'x': x + width, 'y': y + height, 'z': depth}

    def get_resolution(self, plate, pos):
        # All but the following plates were acquired with a DSD with 1px = 0.323um.
        # Plates AU11, AU12, AU13, AU14, AU17 were recorded with an Apotome
        # resulting in 1px = 0.258um. CATMAID expects resoluton to be in px/nm,
        # therefore we have to multiply by 1000. The section thickness was 3um.
        # TODO: Add micrscope type to meta data:
        # Zeiss Axioplan Imaging ApoTome
        # Zeiss Axioplan Imaging ApoTome with DSD1 unit (Andor Technology)
        section_thickness = 3000
        if plate in ('AU.11', 'AU.12', 'AU.13', 'AU.14', 'AU.17'):
            return {'x': 258.0, 'y': 258.0, 'z': section_thickness}
        else:
            return {'x': 323.0, 'y': 323.0, 'z': section_thickness}

    def get_stacks_for_experiment(self, plate, pos):
        # Dimensions are read from an arrangement.txt file
        try:
            dimension = self.get_dimensions(plate, pos)
        except ValueError, e:
            log("Error: " + e.message)
            return []
        resolution = self.get_resolution(plate, pos)

        # If no dimensions were found, no stack can be generated
        if not dimension:
            return []

        stacks = []
        for title, suffix in stack_types.iteritems():
            stacks.append({
                'title': title,
                'image_base':'http://bds.mpi-cbg.de/catmaid/tiles/{0}_{1}/{2}/'.format(
                    plate, pos, suffix),
                'dimension': dimension,
                'resolution': resolution,
                'num_zoom_levels': 3,
                'file_extension': 'jpg',
                'metadata': '',
                'tile_width': 512,
                'tile_height': 512,
                'tile_source_type': 1
            })
        return stacks

def import_from_mysql(cursor, project, user, experiment_provider):
    # Read all experiments and create a class for each column. Create also a
    # class named "experiment" and "experiment property". Each of the column
    # based classed will be linked to "experiment property" with an "is_a"
    # relation. The "experiment_property" class in turn is linked to the
    # experiment class with a "property_of" relation.
    experiment_class, _ = Class.objects.get_or_create(project=project,
            class_name="Experiment", defaults={'user': user})
    exp_property_class, _ = Class.objects.get_or_create(project=project,
            class_name="Experiment property", defaults={'user': user})
    stage_property_class, _ = Class.objects.get_or_create(project=project,
            class_name="Stage property", defaults={'user': user})
    property_of_rel, _ = Relation.objects.get_or_create(project=project,
            relation_name="property_of", defaults={'user': user})
    stage_class, _ = Class.objects.get_or_create(project=project,
            class_name="Stage", defaults={'user': user})
    stack_group_class, _ = Class.objects.get_or_create(project=project,
            class_name="stackgroup", defaults={'user': user})
    is_a_rel, _ = Relation.objects.get_or_create(project=project,
            relation_name="is_a", defaults={'user': user})
    has_channel_rel, _ = Relation.objects.get_or_create(project=project,
            relation_name="has_channel", defaults={'user': user})
    part_of_rel, _ = Relation.objects.get_or_create(project=project,
            relation_name="part_of", defaults={'user': user})
    property_link, _ = ClassClass.objects.get_or_create(project=project,
            class_a=exp_property_class, relation=property_of_rel,
            class_b=experiment_class, defaults={'user': user})
    stage_link, _ = ClassClass.objects.get_or_create(project=project,
            class_a=stage_class, relation=part_of_rel,
            class_b=experiment_class, defaults={'user': user})

    # Get or create property class for each property along with property class
    # 'is_a'-link to the property class.
    prop_class_map = {}
    exp_properties = ("cgname", "flybase_name", "plate", "pos",
            "qc_with_images_minus", "final_word", "est_id", "date", "tf_small",
            "flybase_id", "final_call", "qc_with_images_plus",
            "qc_without_images_plus", "qc_without_images_minus", "amy_review",
            "affy_id", "pavel_review", "primary_annotation",
            "searchable_backup", "display", "searchable", "nr_of_images",
            "cluster_id", "gene_id", "access", "species", "fly_strain", "probe",
            "probe_source", "transgene", "transgenic_line_id", "assay",
            "sequence_type", "tissue", "category", "384_plate")
    for p in exp_properties:
        prop_class, _ = Class.objects.get_or_create(project=project,
                class_name=p, defaults={'user': user})
        identity_link, _ = ClassClass.objects.get_or_create(project=project,
                class_a=prop_class, relation=is_a_rel, class_b=exp_property_class,
                defaults={'user': user})
        prop_class_map[p] = prop_class

    # These properties can be set on stages
    stage_prop_class_map = {}
    stage_properties = ("intensity", "comment")
    for p in stage_properties:
        prop_class, _ = Class.objects.get_or_create(project=project,
                class_name=p, defaults={'user': user})
        identity_link, _ = ClassClass.objects.get_or_create(project=project,
                class_a=prop_class, relation=is_a_rel,
                class_b=stage_property_class, defaults={'user': user})
        stage_prop_class_map[p] = prop_class

    # Get or create classes for stages
    stage_names = {
        "Stage 1": 1,
        "Stage 2-7": 2,
        "Stage 8": 3,
        "Stage 9": 4,
        "Stage 10": 5,
        "Misc": 6, 
    }

    def toStageClass(name):
        key = stage_names[name]
        stage, _ = Class.objects.get_or_create(project=project, class_name=name,
                defaults={'user': user})
        stage_link, _ = ClassClass.objects.get_or_create(project=project,
                class_a=stage, relation=is_a_rel, class_b=stage_class,
                defaults={'user': user}) 
        return stage, key
    # Map stage classes to corresponding keys in original databases
    stage_classes = map(toStageClass, stage_names.keys())

    image_properties = ("flag_as_primary", "magnification", "ap", "dv",
        "orientation", "headedness", "image_processing_flags")

    # Read projects from DB
    effective_exp_fields = exp_properties + ("id",)
    sql = "SELECT {0} FROM main".format(", ".join(effective_exp_fields))

    cursor.execute(sql)
    # For each original result, create one new experiment instance with linked
    # exp_properties.
    experiments_with_images = []
    existing_experiments = cursor.fetchall()
    skipped = []
    for nexp, row in enumerate(existing_experiments):

        main_id = row['id']

        # Name should be like:
        # AU.10 2 - FBgn0025582 - Int6 (CG9677)
        group_title = "{0} {1} - {2} - {3} ({4})".format(row['plate'],
                row['pos'], row['flybase_id'], row['flybase_name'],
                row['cgname'])

        # Stack information could also be just generated, all properties are
        # known in advance and the URL can be generated.
        #stacks = dot_projects.get(group_title, None)
        stacks = experiment_provider.get_stacks_for_experiment(row['plate'], row['pos'])
        if not stacks:
            skipped.append(group_title)
            #log("Skipping group '{}', no stack information found".format(group_title))
            continue

        if len(experiments_with_images) > 10:
            skipped.append(group_title)
            #log("Skipping group '{}', no stack information found".format(group_title))
            continue

        log("Experiment '{}' (oid: {}) - {}/{} - {}".format(group_title,
            main_id, nexp + 1, len(existing_experiments),
            len(experiments_with_images)))

        experiment = ClassInstance.objects.create(project=project,
                user=user, class_column=experiment_class, name=group_title)
        experiments_with_images.append(experiment)
        # Create property instances
        prop_instance_map = {}
        prop_link_map = {}
        for p in exp_properties:
            name = row[p]
            prop_class = prop_class_map[p]
            # If this property is NULL, don't create a new instance
            if name:
                prop_instance = ClassInstance.objects.create(project=project,
                        user=user, class_column=prop_class, name=name)
                prop_link = ClassInstanceClassInstance.objects.create(project=project,
                        user=user, class_instance_a=prop_instance,
                        relation=property_of_rel, class_instance_b=experiment)
                prop_instance_map[p] = prop_instance
                prop_link_map[p] = prop_link
        log("Properties: " + ", ".join(
            ["%s: %s" % (k,v.name) for k,v in prop_instance_map.items()]), 1)

        # Next create stage instances and link them to experiments. Then link
        # classification trees to them.
        stage_instaces = []
        stage_images = {}
        for stage, key in stage_classes:
            si = ClassInstance.objects.create(project=project,
                    user=user, class_column=stage,
                    name="%s: %s" % (name, stage.class_name))
            stage_instaces.append(si)
            # Assign properties, if set
            stage_original_id = stage_names[stage.class_name]
            sql = "SELECT " + (",".join(stage_properties)) + ",id FROM annot " + \
                "WHERE main_id=%s AND stage=%s"
            cursor.execute(sql, (main_id, stage_original_id))
            stage_db_props = cursor.fetchone()
            added_stage_properties = {}
            # The stage ID is the first after all fields in stage_properties
            stage_id = stage_db_props['id']
            for n, p in enumerate(stage_properties):
                stage_prop = stage_db_props[p]
                if stage_prop:
                    pc = stage_prop_class_map[p]
                    sp = ClassInstance.objects.create(project=project,
                            user=user, class_column=pc, name=stage_prop)
                    sl = ClassInstanceClassInstance.objects.create(project=project,
                            user=user, class_instance_a=sp,
                            relation=property_of_rel, class_instance_b=si)
                    added_stage_properties[p] = sp
            log("Stage properties (" + stage.class_name + "): " + ",".join(
                ["%s: %s" % (k,v.name) for k,v in added_stage_properties.items()]), 1)
       
            # Add ROIs from image table. There exists a mapping from Felix'
            # montage creation to original images and to original images
            # relative all image table entries are a cut out of the original.
            # This cut-out is rotated and magnified and cut according to the
            # crop_area table.
            # TODO: Implement
            #sql = "SELECT image_path FROM image WHERE annot_id=%s"
            #cursor.execute(sql, stage_id)
            #rois = []
            sql = """
            SELECT m.id, m.plate, m.pos, a.stage, ca.ant_x, ca.ant_y,
                   ca.post_y, ca.post_y, ca.lat_x, ca.lat_y, ca.slice_index
            FROM image i
            JOIN crop_area ca ON i.id=ca.image_id
            JOIN annot a ON i.annot_id=a.id
            JOIN main m ON a.main_id = m.id
            WHERE annot_id = s
            """

        # Create three image stack per experiment: Ch1, Ch2 and Composite. These
        # are stack references the montage of Felix. Available here:
        # http://bds.mpi-cbg.de/catmaid/data/dot/AU.10_2/AU.10_2-ch1/
        # Properties are requested from the CATMAID instance running there
        new_stacks = []

        if stacks:
            for stack in stacks:
                image_base = stack['image_base']
                res=(stack['resolution']['x'], stack['resolution']['y'], stack['resolution']['z'])
                dim=(stack['dimension']['x'], stack['dimension']['y'], stack['dimension']['z'])
                tile_width=stack['tile_width']
                tile_height=stack['tile_height']
                image=base=stack['image_base']
                stack = Stack.objects.create(title=stack['title'], resolution=res,
                        image_base=image_base, dimension=dim,
                        num_zoom_levels=stack['num_zoom_levels'],
                        file_extension=stack['file_extension'], tile_width=tile_width,
                        tile_height=tile_height, tile_source_type=stack['tile_source_type'])
                new_stacks.append(stack)
                # Link stack into project space
                project_stack = ProjectStack.objects.create(project=project, stack=stack)

            log("Stack image bases: " + ", ".join([s.image_base for s in new_stacks]), 1)

            # stack group should have a name like this:
            # AU.10 2 - FBgn0025582 - Int6 (CG9677)
            stack_group = ClassInstance.objects.create(user=user, project=project,
                    class_column=stack_group_class, name=group_title)

            # Link stack group into experiment
            experiment_stack = ClassInstanceClassInstance(user=user,
                    project=project, class_instance_a=stack_group,
                    relation=part_of_rel, class_instance_b=experiment)

            for stack in new_stacks:
                link = StackClassInstance.objects.create(user=user, project=project,
                        relation=has_channel_rel, stack=stack, class_instance=stack_group)
        else:
            log("No stack info found", 1)


        #log("Stages: " + ",".join(s.name for s in stage_instaces), 1)

        # Classification roots are created for experiments, experiment
        # classifications and stages.

    log("Found {} experiments with stack info".format(len(experiments_with_images)))
    #raise ValueError("Not finished")

def main(options, project, user):
    # Connect to the database
    connection = pymysql.connect(options['host'],
                                 options['user'],
                                 options['password'],
                                 options['db'],
                                 charset='utf8mb4',
                                 cursorclass=pymysql.cursors.DictCursor)
    experiment_provider = ArrangementExperimentProvider(options['arrangements'])

    try:
        import_from_mysql(connection.cursor(), project, user,
                experiment_provider)
    finally:
        connection.close()

def run(project=None, user=None):
    options = {
        'host': 'localhost',
        'user': 'test',
        'password': 'test',
        'db': 'pavel',
        'arrangements': '/home/tom/dev/catmaid-onto/arrangement',
    }
    main(options, project, user)

if __name__ == "__main__":
    run()
