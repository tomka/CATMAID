# -*- coding: utf-8 -*-
# Generated by Django 1.9.10 on 2016-11-28 20:18

from collections import defaultdict
import re

import catmaid.fields
import django.contrib.postgres.fields.jsonb
from django.conf import settings
from django.db import connection, migrations, models
import django.db.models.deletion

forward_prepare = """
    SELECT disable_history_tracking_for_table('stack'::regclass, get_history_table_name('stack'::regclass));
    SELECT drop_history_table('stack'::regclass);

    SELECT disable_history_tracking_for_table('overlay'::regclass, get_history_table_name('overlay'::regclass));
    SELECT drop_history_table('overlay'::regclass);
"""

backward_prepare = """
    SELECT create_history_table('stack'::regclass);
    SELECT create_history_table('overlay'::regclass);
"""

forward_create_default_stack_group_relations = """
    INSERT INTO stack_group_relation (name) VALUES ('view'),('channel')
    ON CONFLICT DO NOTHING
"""

def forward_update_stack_groups(apps, schema_editor):
    """Create a stack group entry for each stack group class instance and link
    stacks linked to respective class instance to new stack group.
    """

    ClassInstance = apps.get_model('catmaid', 'ClassInstance')
    StackGroup = apps.get_model('catmaid', 'StackGroup')
    existing_stackgroups = ClassInstance.objects.filter(
            class_column__class_name='stackgroup')

    sg_id_mapping = {}
    sg_names = set()

    for sg in existing_stackgroups:
        if sg.name in sg_names:
            name = f"{sg.name} ({sg.project.id})"
        else:
            name = sg.name

        new_sg = StackGroup.objects.create(title=name)
        sg_id_mapping[sg.id] = new_sg.id

    if not sg_id_mapping:
        return

    sg_pattern = ','.join([f"({k}, {v})" for k,v in sg_id_mapping.items()])
    cursor = connection.cursor()
    cursor.execute(f"""
        INSERT INTO stack_stack_group (stack_id, stack_group_id, group_relation_id, position)
        SELECT sci.stack_id, sg_mapping.new_id, sgr.id, 0
        FROM stack_class_instance sci
        JOIN (VALUES {sg_pattern}) sg_mapping(old_id, new_id)
        ON sci.class_instance_id = sg_mapping.old_id
        JOIN relation r
        ON sci.relation_id = r.id
        JOIN stack_group_relation sgr
        ON 'has_' || sgr.name = r.relation_name
    """)


def forward_migrate_overlays(apps, schema_editor):
    """For each overlay, instead create a stack and a stack group relating the
    new stack to the overlay's existing stack.
    """
    cursor = connection.cursor()

    # Create groups for each stack that has an overlay, and mapping from that
    # stack's ID to the group ID.
    cursor.execute("""
        SELECT s.id, s.title
        FROM overlay o
        JOIN stack s ON s.id = o.stack_id
        GROUP BY s.id
    """)
    stacks = cursor.fetchall()

    stack_titles = defaultdict(list)
    for stack in stacks:
        stack_titles[stack[1]].append(stack[0])

    cursor.execute('''
        INSERT INTO stack_group (title)
        SELECT s.title
        FROM overlay o
        JOIN stack s ON s.id = o.stack_id
        GROUP BY s.id
        RETURNING id, title
        ''')
    sgs = cursor.fetchall()

    if not sgs:
        return

    stack_id_mapping = {}
    sg_titles = defaultdict(list)
    for group in sgs:
        sg_titles[group[1]].append(group[0])

    for title, stack_ids in stack_titles.items():
        group_ids = sg_titles[title]
        for stack_id, group_id in zip(stack_ids, group_ids):
            stack_id_mapping[stack_id] = group_id

    # Associate each stack to its group.
    cursor.execute("""
        INSERT INTO stack_stack_group (stack_id, stack_group_id, group_relation_id, position)
        SELECT
            s.id,
            sgim.sg_id,
            (SELECT id FROM stack_group_relation WHERE name = 'view'),
            0
        FROM stack s
        JOIN (VALUES {}) AS sgim (s_id, sg_id) ON sgim.s_id = s.id
    """.format(
        ','.join([f'({k}, {v})' for k, v in stack_id_mapping.items()])))

    # Create stacks for each overlay.
    # Note stack is still the old stack model at this point.
    cursor.execute("""
        INSERT INTO stack (
            title, dimension, resolution, image_base, num_zoom_levels,
            file_extension, tile_width, tile_height, tile_source_type,
            metadata, trakem2_project)
        SELECT
            o.title, s.dimension, s.resolution, o.image_base, s.num_zoom_levels,
            o.file_extension, o.tile_width, o.tile_height, o.tile_source_type,
            'Migrated overlay ' || o.id, FALSE
        FROM overlay o
        JOIN stack s ON s.id = o.stack_id
        RETURNING id, metadata
    """)
    new_stacks = cursor.fetchall()
    overlay_stacks_ids = defaultdict()
    for stack in new_stacks:
        overlay_id = re.match(r'^Migrated overlay (\d+)$', stack[1]).group(1)
        overlay_stacks_ids[overlay_id] = stack[0]

    # Associate each new overlay stack to the overlay group for its parent stack.
    cursor.execute("""
        INSERT INTO stack_stack_group (stack_id, stack_group_id, group_relation_id, position)
        SELECT
            nsim.s_id,
            sgim.sg_id,
            (SELECT id FROM stack_group_relation WHERE name = 'view'),
            0
        FROM overlay o
        JOIN (VALUES {}) AS nsim (o_id, s_id) ON nsim.o_id = o.id
        JOIN (VALUES {}) AS sgim (s_id, sg_id) ON sgim.s_id = o.stack_id
    """.format(
        ','.join(['({}, {})'.format(k, v) for k, v in overlay_stacks_ids.items()]),
        ','.join(['({}, {})'.format(k, v) for k, v in stack_id_mapping.items()])))


forward_create_stack_mirrors = """
    INSERT INTO stack_mirror (stack_id, title, image_base, file_extension, tile_width, tile_height, tile_source_type, position)
    SELECT s.id, 'Default', s.image_base, s.file_extension, s.tile_width, s.tile_height, s.tile_source_type, 0
    FROM stack s;
"""

backward_create_stacks_from_mirrors = """
    UPDATE stack SET (image_base, file_extension, tile_width, tile_height, tile_source_type)
    = (sm.image_base, sm.file_extension, sm.tile_width, sm.tile_height, sm.tile_source_type)
    FROM stack_mirror sm
    WHERE sm.id = (
        SELECT sm2.id
        FROM stack_mirror sm2
        WHERE sm2.stack_id = stack.id
        ORDER BY sm2.position ASC
        LIMIT 1);
"""


forward_create_stack_group_class_instance = """
    CREATE TABLE stack_group_class_instance (
        stack_group_id integer REFERENCES stack_group (id) DEFERRABLE INITIALLY DEFERRED,
        class_instance_id integer REFERENCES class_instance (id) DEFERRABLE INITIALLY DEFERRED
    )
    INHERITS (relation_instance);

    ALTER TABLE stack_group_class_instance
        ADD CONSTRAINT stack_group_class_instance_pkey PRIMARY KEY (id);
"""

backward_create_stack_group_class_instance = """
    DROP TABLE stack_group_class_instance;
"""


forward_restore_history = """
    SELECT create_history_table('stack'::regclass);
    SELECT create_history_table('stack_mirror'::regclass);
    SELECT create_history_table('stack_group_relation'::regclass);
    SELECT create_history_table('stack_group'::regclass);
    SELECT create_history_table('stack_stack_group'::regclass);
    SELECT create_history_table('stack_group_class_instance'::regclass, 'edition_time', 'txid');
"""

backward_restore_history = """
    SELECT disable_history_tracking_for_table('stack'::regclass, get_history_table_name('stack'::regclass));
    SELECT drop_history_table('stack'::regclass);

    SELECT disable_history_tracking_for_table('stack_mirror'::regclass, get_history_table_name('stack_mirror'::regclass));
    SELECT drop_history_table('stack_mirror'::regclass);

    SELECT disable_history_tracking_for_table('stack_group_relation'::regclass, get_history_table_name('stack_group_relation'::regclass));
    SELECT drop_history_table('stack_group_relation'::regclass);

    SELECT disable_history_tracking_for_table('stack_group'::regclass, get_history_table_name('stack_group'::regclass));
    SELECT drop_history_table('stack_group'::regclass);

    SELECT disable_history_tracking_for_table('stack_stack_group'::regclass, get_history_table_name('stack_stack_group'::regclass));
    SELECT drop_history_table('stack_stack_group'::regclass);

    SELECT disable_history_tracking_for_table('stack_group_class_instance'::regclass, get_history_table_name('stack_group_class_instance'::regclass));
    SELECT drop_history_table('stack_group_class_instance'::regclass);
"""


class Migration(migrations.Migration):

    dependencies = [
        ('catmaid', '0017_update_edge_indices'),
    ]

    operations = [
        migrations.RunSQL(forward_prepare, backward_prepare),
        migrations.CreateModel(
            name='StackGroupRelation',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.TextField(max_length=80)),
            ],
            options={
                'db_table': 'stack_group_relation',
            },
        ),
        migrations.RunSQL(forward_create_default_stack_group_relations, migrations.RunSQL.noop),
        migrations.CreateModel(
            name='StackMirror',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('stack', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='catmaid.Stack')),
                ('title', models.TextField(help_text='Descriptive title of this stack mirror.')),
                ('image_base', models.TextField(help_text='Fully qualified URL where the tile data can be found.')),
                ('file_extension', models.TextField(blank=True, default='jpg', help_text='The file extension of the data files.')),
                ('tile_width', models.IntegerField(default=256, help_text='The width of one tile.')),
                ('tile_height', models.IntegerField(default=256, help_text='The height of one tile.')),
                ('tile_source_type', models.IntegerField(choices=[(1, '1: File-based image stack'), (2, '2: Request query-based image stack'), (3, '3: HDF5 via CATMAID backend'), (4, '4: File-based image stack with zoom level directories'), (5, '5: Directory-based image stack'), (6, '6: DVID imageblk voxels'), (7, '7: Render service'), (8, '8: DVID imagetile tiles'), (9, '9: FlixServer tiles'), (10, '10: H2N5 tiles')], default=1, help_text='This represents how the tile data is organized. See <a href="http://catmaid.org/page/tile_sources.html">tile source conventions documentation</a>.')),
                ('position', models.IntegerField(default=0)),
            ],
            options={
                'ordering': ('position',),
                'db_table': 'stack_mirror',
            },
        ),
        migrations.DeleteModel(
            name='StackGroup',
        ),
        migrations.DeleteModel(
            name='StackStackGroup',
        ),
        migrations.CreateModel(
            name='StackGroup',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.TextField(default='', max_length=80)),
                ('comment', models.TextField(help_text='A comment that describes the stack group.', null=True, blank=True)),
            ],
            options={
                'db_table': 'stack_group',
            },
        ),
        migrations.CreateModel(
            name='StackStackGroup',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('group_relation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='catmaid.StackGroupRelation')),
                ('position', models.IntegerField(default=0)),
                ('stack', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='catmaid.Stack')),
                ('stack_group', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='catmaid.StackGroup')),
            ],
            options={
                'ordering': ('position',),
                'db_table': 'stack_stack_group',
            },
        ),
        migrations.RunPython(forward_update_stack_groups, migrations.RunPython.noop),
        migrations.RunPython(forward_migrate_overlays, migrations.RunPython.noop),
        migrations.RunSQL(forward_create_stack_mirrors, backward_create_stacks_from_mirrors),
        migrations.DeleteModel(
            name='Overlay',
        ),
        migrations.RemoveField(
            model_name='stack',
            name='file_extension',
        ),
        migrations.RemoveField(
            model_name='stack',
            name='image_base',
        ),
        migrations.RemoveField(
            model_name='stack',
            name='tile_height',
        ),
        migrations.RemoveField(
            model_name='stack',
            name='tile_source_type',
        ),
        migrations.RemoveField(
            model_name='stack',
            name='tile_width',
        ),
        migrations.RemoveField(
            model_name='stack',
            name='trakem2_project',
        ),
        migrations.AddField(
            model_name='stack',
            name='attribution',
            field=models.TextField(blank=True, help_text='Attribution or citation information for this dataset.', null=True),
        ),
        migrations.AddField(
            model_name='stack',
            name='canary_location',
            field=catmaid.fields.Integer3DField(default=(0, 0, 0), help_text='Stack space coordinates at zoom level 0 where image data is expected to exist.'),
        ),
        migrations.AddField(
            model_name='stack',
            name='placeholder_color',
            field=catmaid.fields.RGBAField(default=(0, 0, 0, 1)),
        ),
        migrations.AlterField(
            model_name='clientdata',
            name='value',
            field=django.contrib.postgres.fields.jsonb.JSONField(default=dict),
        ),
        migrations.RenameField(
            model_name='stack',
            old_name='metadata',
            new_name='description'
        ),
        migrations.AddField(
            model_name='stack',
            name='metadata',
            field=django.contrib.postgres.fields.jsonb.JSONField(blank=True, null=True),
        ),
        migrations.RunSQL(
            forward_create_stack_group_class_instance,
            backward_create_stack_group_class_instance,
            [migrations.CreateModel(
                name='StackGroupClassInstance',
                fields=[
                    ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                    ('creation_time', models.DateTimeField(default=django.utils.timezone.now)),
                    ('edition_time', models.DateTimeField(default=django.utils.timezone.now)),
                    ('class_instance', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='catmaid.ClassInstance')),
                    ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='catmaid.Project')),
                    ('relation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='catmaid.Relation')),
                    ('stack_group', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='catmaid.StackGroup')),
                    ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
                ],
                options={
                    'db_table': 'stack_group_class_instance',
                },
            )]
        ),
        migrations.RunSQL(forward_restore_history, backward_restore_history),
    ]
