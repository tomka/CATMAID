from django.core.management.base import NoArgsCommand, CommandError
from optparse import make_option
from django.core.management import call_command
from django.conf import settings
from django.db.models import Count

from catmaid.models import *
from catmaid.fields import *
from catmaid.control import classification as cls
from catmaid.control.ontology import get_class_links_qs

import MySQLdb

tissue_tags = {
    'salivary_gland': 'Salivary Gland',
    'cns': 'CNS',
    'fat_body': 'Fat Body',
    'wing_disc': 'Wing Disc',
    'ovary': 'Ovariole',
    'testis': 'Testis'}
tissue_ontology = {
    'salivary_gland': 'salivary gland classification',
    'cns': 'CNS classification',
    'fat_body': 'fat body classification',
    'wing_disc': 'wing disc classification',
    'ovary': 'ovary classification',
    'testis': 'testis classification'}

class_mapping = {}

class Experiment:
    def __init__(self, est_id, rab, tissue_id, tissue, ontology):
        self.est_id = est_id
        self.rab = rab
        self.tissue_id = tissue_id
        self.tissue = tissue
        self.ontology = ontology
        # Tags used in the CATMAID database
        self.rab_tag = rab.replace('rab', 'Rab')
        self.tissue_tag = tissue_tags[tissue]

class Node:
    def __init__(self, node_id, name, is_selected):
        self.node_id = node_id
        self.name = name
        self.is_selected = is_selected

    def __unicode__(self):
        return "Node %s with name '%s'" % (str(self.node_id), self.name)

def get_roots(cursor):
    cursor.execute("SELECT term.id, go_term, stage_id FROM term, stage_term " \
        "WHERE type = 'root' AND term.id = stage_term.term_id")
    return cursor.fetchall()

class Command(NoArgsCommand):
    help = "Import classifications from Pavel's tool into CATMAID"

    option_list = NoArgsCommand.option_list + (
        make_option('--user', dest='user_id', help='The ID of the who owns the class instances'),
        )

    def draw_node(self, payload, node, level, comment=""):
        # Print child
        line = ""
        for i in range(0, level):
            line = line + "\t"
        if node.is_selected:
            line = line + "* "
        else:
            line = line + "  "
        line = "%s%s (%s)" % (line, node.name, str(node.node_id)) 
        if len(comment) > 0:
            line = "%s --- %s" % (line, comment)
        print(line)


    def import_node(self, parent, node, level, verbose=True):
        # The root node, doesn't need any treatment
        if level == 1:
            return parent
        # Don't create a class instance if the node isn't selected
        if not node.is_selected:
            return None
        # Find class that is type of the current node.
        # Node names of the following tissues can be used as class names
        # directly: testis, fat_body
        try:
            klass = Class.objects.get(project_id=self.workspace_pid, class_name=node.name)
        except Class.DoesNotExist:
            raise StandardError("Couln't find class for node: " + node.__unicode__())

        msg = "Class: %s\tTerm: %s" % (klass.class_name, node.name)
        # If wanted, be more verbose about the node
        if verbose:
            self.draw_node(parent, node, level, msg)
        else:
            print(msg)

        # Create a new class instance for this node
        ci = ClassInstance(user=self.user,name=node.name)
        ci.project_id = self.workspace_pid
        ci.class_column = klass
        ci.save()

        # Get the part_of relation
        rel = Relation.objects.get(project_id=self.workspace_pid,
            relation_name="part_of")

        # Link this CI to its parent (expect parent to be a CI)
        cici = ClassInstanceClassInstance()
        cici.user = self.user
        cici.project_id = self.workspace_pid
        cici.relation = rel
        cici.class_instance_a = ci
        cici.class_instance_b = parent
        cici.save()

        # Return new parent
        return ci

    def traverse_hierarchy(self, cur, checked_terms, root, payload, fun, mapping, level=0):
        level = level + 1
        # Select children of root
        children_select = "SELECT term2_id, go_term, rel_type, stage_id, " \
            "term_2_term.id, term.type, sort_order FROM term, term_2_term, " \
            "stage_term WHERE term1_id = %s and term2_id = term.id and " \
            "term2_id = stage_term.term_id order by rel_type DESC"
        cur.execute(children_select, (root,))
        # Sort according to sort_order
        children = sorted(cur.fetchall(), key=lambda row: row[6])
        # Make sure there is a parent
        for row in children:
            child_id = int(row[0])
            child_name = row[1]
            rel_type = row[2]
            stage = int(row[3])
            rel_id = int(row[4])
            term_type = row[5]
            order = row[6]
            is_selected = child_id in checked_terms
            # Check if the node needs to be renamed
            if child_name in mapping:
                child_name = mapping[child_name]
            # Call visitor method
            node = Node(child_id, child_name, is_selected)
            new_payload = fun(payload, node, level)
            self.traverse_hierarchy(cur, checked_terms, child_id, new_payload, fun, mapping, level)

    def handle_noargs(self, **options):
        # Get user to associate with new entities
        if not options['user_id']:
            raise CommandError, "You must specify a user ID with --user"
        self.user = User.objects.get(pk=options['user_id'])

        # Select the dummy project as workspace (work project
        # independent)
        self.workspace_pid = settings.ONTOLOGY_DUMMY_PROJECT_ID

        # Connect to Pavel's database and create a cursor to execute our
        # queries
        pdb = MySQLdb.connect(host="localhost", user="www-data", passwd="insitu", db="rabs_new")
        pcur = pdb.cursor()

        # Get tags and tissues
        pcur.execute("SELECT distinct(gene_id), flybase_id, cgname from main")
        rabs = pcur.fetchall()
        pcur.execute("SELECT id, name from stage")
        tissues = pcur.fetchall()

        # Find ontologies for each tissue
        ontologies = {}
        root_class_links = get_class_links_qs(self.workspace_pid, 'is_a', 'classification_root')
        for t in tissues:
            t_id = t[1]
            o_name = tissue_ontology[t_id]
            # Find CATMAID ontology
            for o in root_class_links:
                if o.class_a.class_name == o_name:
                    ontologies[t_id] = o
                    break
        # Make sure there is an ontology for every tissue:
        for t in tissues:
            if t[1] not in ontologies:
                raise StandardError("There is no ontology for tissue %s" % str(t[0]))

        # Get all experiments
        exp_q = "SELECT est_id, count(*) from main LEFT JOIN annot on " \
            "main.id = annot.main_id LEFT JOIN image on annot.id = image.annot_id " \
            "where gene_id = %s and annot.stage = %s group by est_id"
        experiments = []
        for rab in rabs:
            for tissue in tissues:
                tid = tissue[0]
                pcur.execute(exp_q, (rab[0], tid))
                for exp in pcur.fetchall():
                    tname = tissue[1]
                    experiments.append( Experiment(exp[0], rab[0], tid, tname,
                        ontologies[tname]) )

        # Select roots which should be imported
        # done: testis, fat_body, wing_disc, salivary_gland, ovary, cns
        roots_to_import = ['salivary_gland','cns','fat_body','wing_disc','ovary','testis']
        max_num_imports = 100000
        imported_graphs = 0
        show = False
        #show = True

        # Get roots for stages
        roots = {}
        for r in get_roots(pcur):
            roots[r[2]] = r[0]

        # Iterate all avilable experiments
        print("Experiments:")
        for n, exp in enumerate(experiments):
            # Only import wanted roots
            if imported_graphs >= max_num_imports:
                break
            if exp.tissue not in roots_to_import:
                continue
            print("%s %s: %s" % (exp.tissue_tag, exp.rab_tag, exp.est_id))

            # Get selected terms for this experiment
            pcur.execute("SELECT annot.id, annot.stage, annot.comment, " \
                "annot.intensity FROM annot, main where est_id = %s AND " \
                "main.id = annot.main_id", (exp.est_id,))
            checked_terms = []
            for annot_id, stage_id, comment, note in pcur.fetchall():
                pcur.execute("SELECT term_id FROM annot_term WHERE annot_id = %s", (annot_id,))
                for terms in pcur.fetchall():
                    for term in terms:
                        checked_terms.append(term)

            # If there is already a classification graph for this Rab/tissue
            # combination, use it. Otherwise create a new classification graph
            # in dummy project space.
            always_create_new_graph = True

            mapping = {}
            root = roots[exp.tissue_id]
            if show:
                self.traverse_hierarchy(pcur, checked_terms, root, None, self.draw_node, mapping)
            else: 
                if always_create_new_graph:
                    # Create classification and name it according to rab/tissue
                    cg = cls.init_new_classification( self.workspace_pid,
                        self.user, exp.ontology.class_a)
                    cg.name = "Classification for %s %s " % (exp.tissue_tag, exp.rab_tag)
                    cg.save()
                else:
                    raise StandardException("Not implemented yet.")

                # Collect all defining tags and the projects matching *all* of them.
                # This matches the controls, too, but this is wanted.
                tags = [exp.rab_tag, exp.tissue_tag, "Rablibrary"]
                projects = Project.objects.filter( tags__name__in=tags ).annotate(
                    repeat_count=Count("id") ).filter( repeat_count=len(tags) )
                print("Found %s projects matching the tags %s." % (str(len(projects)), str(tags)))
                # If not already done, link the classification graph to all
                # projects that have the rab and tissue tags of the expermint.
                for p in projects:
                    cls.link_existing_classification( self.workspace_pid, self.user, p, cg )

                # For different tissues are special cases needed
                if exp.tissue == 'wing_disc':
                    # The existing wing disc annotations can be used as is, but
                    # need to be added below an "early 3rd instar" node.
                    node = Node(-1, "early 3rd instar", True)
                    cg = self.import_node(cg, node, level=2, verbose=True)
                elif exp.tissue == 'ovary':
                    # Add some renamings
                    mapping['follicle cells'] = 'follicle cell'
                elif exp.tissue == 'cns':
                    mapping['optic anlage'] = 'optic anlage cells'

                # Traverse hierarchies
                self.traverse_hierarchy(pcur, checked_terms, root, cg, self.import_node, mapping)
            # Increase counter for imported graphs
            imported_graphs = imported_graphs + 1

        print("Done")
