# -*- coding: utf-8 -*-
from __future__ import unicode_literals

from django.db import models, migrations
import datetime
import catmaid.control.user
import catmaid.fields
from django.conf import settings
import taggit.managers


class Migration(migrations.Migration):

    dependencies = [
        ('taggit', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ApiKey',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('description', models.TextField()),
                ('key', models.CharField(max_length=128)),
            ],
            options={
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='BrokenSlice',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('index', models.IntegerField()),
            ],
            options={
                'db_table': 'broken_slice',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='CardinalityRestriction',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('enabled', models.BooleanField(default=True)),
                ('cardinality_type', models.IntegerField()),
                ('value', models.IntegerField()),
            ],
            options={
                'db_table': 'cardinality_restriction',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='ChangeRequest',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('type', models.CharField(max_length=32)),
                ('description', models.TextField()),
                ('status', models.IntegerField(default=0)),
                ('location', catmaid.fields.Double3DField()),
                ('validate_action', models.TextField()),
                ('approve_action', models.TextField()),
                ('reject_action', models.TextField()),
                ('completion_time', models.DateTimeField(default=None, null=True)),
            ],
            options={
                'db_table': 'change_request',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Class',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('class_name', models.CharField(max_length=255)),
                ('description', models.TextField()),
            ],
            options={
                'db_table': 'class',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='ClassClass',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('class_a', models.ForeignKey(related_name='classes_a', db_column=b'class_a', to='catmaid.Class')),
                ('class_b', models.ForeignKey(related_name='classes_b', db_column=b'class_b', to='catmaid.Class')),
            ],
            options={
                'db_table': 'class_class',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='ClassInstance',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('name', models.CharField(max_length=255)),
                ('class_column', models.ForeignKey(to='catmaid.Class', db_column=b'class_id')),
            ],
            options={
                'db_table': 'class_instance',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='ClassInstanceClassInstance',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('class_instance_a', models.ForeignKey(related_name='cici_via_a', db_column=b'class_instance_a', to='catmaid.ClassInstance')),
                ('class_instance_b', models.ForeignKey(related_name='cici_via_b', db_column=b'class_instance_b', to='catmaid.ClassInstance')),
            ],
            options={
                'db_table': 'class_instance_class_instance',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Concept',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
            ],
            options={
                'db_table': 'concept',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Connector',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('location_x', models.FloatField()),
                ('location_y', models.FloatField()),
                ('location_z', models.FloatField()),
                ('confidence', models.IntegerField(default=5)),
                ('editor', models.ForeignKey(related_name='connector_editor', db_column=b'editor_id', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'connector',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='ConnectorClassInstance',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('class_instance', models.ForeignKey(to='catmaid.ClassInstance')),
                ('connector', models.ForeignKey(to='catmaid.Connector')),
            ],
            options={
                'db_table': 'connector_class_instance',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='DataView',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('title', models.TextField()),
                ('config', models.TextField(default=b'{}')),
                ('is_default', models.BooleanField(default=False)),
                ('position', models.IntegerField(default=0)),
                ('comment', models.TextField(default=b'', null=True, blank=True)),
            ],
            options={
                'ordering': ('position',),
                'db_table': 'data_view',
                'permissions': (('can_administer_dataviews', 'Can administer data views'), ('can_browse_dataviews', 'Can browse data views')),
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='DataViewType',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('title', models.TextField()),
                ('code_type', models.TextField()),
                ('comment', models.TextField(null=True, blank=True)),
            ],
            options={
                'db_table': 'data_view_type',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='DeprecatedAppliedMigrations',
            fields=[
                ('id', models.CharField(max_length=32, serialize=False, primary_key=True)),
            ],
            options={
                'db_table': 'applied_migrations',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='DeprecatedSession',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('session_id', models.CharField(max_length=26)),
                ('data', models.TextField(default=b'')),
                ('last_accessed', models.DateTimeField(default=datetime.datetime.now)),
            ],
            options={
                'db_table': 'sessions',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Location',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('location_x', models.FloatField()),
                ('location_y', models.FloatField()),
                ('location_z', models.FloatField()),
                ('editor', models.ForeignKey(related_name='location_editor', db_column=b'editor_id', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'location',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Log',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('operation_type', models.CharField(max_length=255)),
                ('location', catmaid.fields.Double3DField()),
                ('freetext', models.TextField()),
            ],
            options={
                'db_table': 'log',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Message',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('time', models.DateTimeField(default=datetime.datetime.now)),
                ('read', models.BooleanField(default=False)),
                ('title', models.TextField()),
                ('text', models.TextField(default=b'New message', null=True, blank=True)),
                ('action', models.TextField(null=True, blank=True)),
                ('user', models.ForeignKey(to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'message',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Overlay',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('title', models.TextField()),
                ('image_base', models.TextField()),
                ('default_opacity', models.IntegerField(default=0)),
                ('file_extension', models.TextField()),
                ('tile_width', models.IntegerField(default=512)),
                ('tile_height', models.IntegerField(default=512)),
                ('tile_source_type', models.IntegerField(default=1)),
            ],
            options={
                'db_table': 'overlay',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Project',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('title', models.TextField()),
                ('comment', models.TextField(null=True, blank=True)),
            ],
            options={
                'db_table': 'project',
                'managed': True,
                'permissions': (('can_administer', 'Can administer projects'), ('can_annotate', 'Can annotate projects'), ('can_browse', 'Can browse projects')),
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='ProjectStack',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('translation', catmaid.fields.Double3DField(default=(0, 0, 0))),
                ('orientation', models.IntegerField(default=0, choices=[(0, b'xy'), (1, b'xz'), (2, b'zy')])),
                ('project', models.ForeignKey(to='catmaid.Project')),
            ],
            options={
                'db_table': 'project_stack',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='RegionOfInterest',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('location_x', models.FloatField()),
                ('location_y', models.FloatField()),
                ('location_z', models.FloatField()),
                ('zoom_level', models.IntegerField()),
                ('width', models.FloatField()),
                ('height', models.FloatField()),
                ('rotation_cw', models.FloatField()),
                ('editor', models.ForeignKey(related_name='roi_editor', db_column=b'editor_id', to=settings.AUTH_USER_MODEL)),
                ('project', models.ForeignKey(to='catmaid.Project')),
            ],
            options={
                'db_table': 'region_of_interest',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='RegionOfInterestClassInstance',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('class_instance', models.ForeignKey(to='catmaid.ClassInstance')),
                ('project', models.ForeignKey(to='catmaid.Project')),
                ('region_of_interest', models.ForeignKey(to='catmaid.RegionOfInterest')),
            ],
            options={
                'db_table': 'region_of_interest_class_instance',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Relation',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('relation_name', models.CharField(max_length=255)),
                ('uri', models.TextField()),
                ('description', models.TextField()),
                ('isreciprocal', models.BooleanField(default=False)),
                ('project', models.ForeignKey(to='catmaid.Project')),
                ('user', models.ForeignKey(to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'relation',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='RelationInstance',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('project', models.ForeignKey(to='catmaid.Project')),
                ('relation', models.ForeignKey(to='catmaid.Relation')),
                ('user', models.ForeignKey(to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'relation_instance',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Restriction',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('enabled', models.BooleanField(default=True)),
                ('project', models.ForeignKey(to='catmaid.Project')),
                ('restricted_link', models.ForeignKey(to='catmaid.ClassClass')),
                ('user', models.ForeignKey(to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'restriction',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Review',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('review_time', models.DateTimeField(default=datetime.datetime.now)),
                ('project', models.ForeignKey(to='catmaid.Project')),
                ('reviewer', models.ForeignKey(to=settings.AUTH_USER_MODEL)),
                ('skeleton', models.ForeignKey(to='catmaid.ClassInstance')),
            ],
            options={
                'db_table': 'review',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='ReviewerWhitelist',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('accept_after', models.DateTimeField(default=datetime.datetime(1, 1, 1, 0, 0))),
                ('project', models.ForeignKey(to='catmaid.Project')),
                ('reviewer', models.ForeignKey(related_name='+', to=settings.AUTH_USER_MODEL)),
                ('user', models.ForeignKey(to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'reviewer_whitelist',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Settings',
            fields=[
                ('key', models.TextField(serialize=False, primary_key=True)),
                ('value', models.TextField(null=True)),
            ],
            options={
                'db_table': 'settings',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Stack',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('title', models.TextField(help_text=b'Descriptive title of this stack.')),
                ('dimension', catmaid.fields.Integer3DField(help_text=b'The pixel dimensionality of the stack.')),
                ('resolution', catmaid.fields.Double3DField(help_text=b'The resolution of the stack in nanometers.')),
                ('image_base', models.TextField(help_text=b'Fully qualified URL where the tile data can be found.')),
                ('comment', models.TextField(help_text=b'A comment that describes the image data.', null=True, blank=True)),
                ('trakem2_project', models.BooleanField(default=False, help_text=b'Is TrakEM2 the source of this stack?')),
                ('num_zoom_levels', models.IntegerField(default=-1, help_text=b"The number of zoom levels a stack has data for. A value of -1 lets CATMAID dynamically determine the actual value so that at this value the largest extent (X or Y) won't be smaller than 1024 pixels. Values larger -1 will be used directly.")),
                ('file_extension', models.TextField(default=b'jpg', help_text=b'The file extension of the data files.', blank=True)),
                ('tile_width', models.IntegerField(default=256, help_text=b'The width of one tile.')),
                ('tile_height', models.IntegerField(default=256, help_text=b'The height of one tile.')),
                ('tile_source_type', models.IntegerField(default=1, help_text=b'This represents how the tile data is organized.')),
                ('metadata', models.TextField(default=b'', help_text=b'Arbitrary text that is displayed alongside the stack.', blank=True)),
                ('tags', taggit.managers.TaggableManager(to='taggit.Tag', through='taggit.TaggedItem', blank=True, help_text='A comma-separated list of tags.', verbose_name='Tags')),
            ],
            options={
                'db_table': 'stack',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Textlabel',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('type', models.CharField(max_length=32)),
                ('text', models.TextField(default=b'Edit this text ...')),
                ('colour', catmaid.fields.RGBAField(default=(1, 0.5, 0, 1))),
                ('font_name', models.TextField(null=True)),
                ('font_style', models.TextField(null=True)),
                ('font_size', models.FloatField(default=32)),
                ('scaling', models.BooleanField(default=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('deleted', models.BooleanField(default=False)),
                ('project', models.ForeignKey(to='catmaid.Project')),
            ],
            options={
                'db_table': 'textlabel',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='TextlabelLocation',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('location', catmaid.fields.Double3DField()),
                ('deleted', models.BooleanField(default=False)),
                ('textlabel', models.ForeignKey(to='catmaid.Textlabel')),
            ],
            options={
                'db_table': 'textlabel_location',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='Treenode',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('location_x', models.FloatField()),
                ('location_y', models.FloatField()),
                ('location_z', models.FloatField()),
                ('radius', models.FloatField()),
                ('confidence', models.IntegerField(default=5)),
                ('editor', models.ForeignKey(related_name='treenode_editor', db_column=b'editor_id', to=settings.AUTH_USER_MODEL)),
                ('parent', models.ForeignKey(related_name='children', to='catmaid.Treenode', null=True)),
                ('project', models.ForeignKey(to='catmaid.Project')),
                ('skeleton', models.ForeignKey(to='catmaid.ClassInstance')),
                ('user', models.ForeignKey(to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'treenode',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='TreenodeClassInstance',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('class_instance', models.ForeignKey(to='catmaid.ClassInstance')),
                ('project', models.ForeignKey(to='catmaid.Project')),
                ('relation', models.ForeignKey(to='catmaid.Relation')),
                ('treenode', models.ForeignKey(to='catmaid.Treenode')),
                ('user', models.ForeignKey(to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'treenode_class_instance',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='TreenodeConnector',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('creation_time', models.DateTimeField(default=datetime.datetime.now)),
                ('edition_time', models.DateTimeField(default=datetime.datetime.now)),
                ('confidence', models.IntegerField(default=5)),
                ('connector', models.ForeignKey(to='catmaid.Connector')),
                ('project', models.ForeignKey(to='catmaid.Project')),
                ('relation', models.ForeignKey(to='catmaid.Relation')),
                ('skeleton', models.ForeignKey(to='catmaid.ClassInstance')),
                ('treenode', models.ForeignKey(to='catmaid.Treenode')),
                ('user', models.ForeignKey(to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'treenode_connector',
            },
            bases=(models.Model,),
        ),
        migrations.CreateModel(
            name='UserProfile',
            fields=[
                ('id', models.AutoField(verbose_name='ID', serialize=False, auto_created=True, primary_key=True)),
                ('inverse_mouse_wheel', models.BooleanField(default=False)),
                ('display_stack_reference_lines', models.BooleanField(default=False)),
                ('independent_ontology_workspace_is_default', models.BooleanField(default=False)),
                ('show_text_label_tool', models.BooleanField(default=False)),
                ('show_tagging_tool', models.BooleanField(default=False)),
                ('show_cropping_tool', models.BooleanField(default=False)),
                ('show_segmentation_tool', models.BooleanField(default=False)),
                ('show_tracing_tool', models.BooleanField(default=False)),
                ('show_ontology_tool', models.BooleanField(default=False)),
                ('show_roi_tool', models.BooleanField(default=False)),
                ('color', catmaid.fields.RGBAField(default=catmaid.control.user.distinct_user_color)),
                ('tracing_overlay_screen_scaling', models.BooleanField(default=True)),
                ('tracing_overlay_scale', models.FloatField(default=1)),
                ('prefer_webgl_layers', models.BooleanField(default=False)),
                ('use_cursor_following_zoom', models.BooleanField(default=True)),
                ('user', models.OneToOneField(to=settings.AUTH_USER_MODEL)),
            ],
            options={
            },
            bases=(models.Model,),
        ),
        migrations.AlterUniqueTogether(
            name='reviewerwhitelist',
            unique_together=set([('project', 'user', 'reviewer')]),
        ),
        migrations.AddField(
            model_name='review',
            name='treenode',
            field=models.ForeignKey(to='catmaid.Treenode'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='regionofinterestclassinstance',
            name='relation',
            field=models.ForeignKey(to='catmaid.Relation'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='regionofinterestclassinstance',
            name='user',
            field=models.ForeignKey(to=settings.AUTH_USER_MODEL),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='regionofinterest',
            name='stack',
            field=models.ForeignKey(to='catmaid.Stack'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='regionofinterest',
            name='user',
            field=models.ForeignKey(to=settings.AUTH_USER_MODEL),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='projectstack',
            name='stack',
            field=models.ForeignKey(to='catmaid.Stack'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='project',
            name='stacks',
            field=models.ManyToManyField(to='catmaid.Stack', through='catmaid.ProjectStack'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='project',
            name='tags',
            field=taggit.managers.TaggableManager(to='taggit.Tag', through='taggit.TaggedItem', blank=True, help_text='A comma-separated list of tags.', verbose_name='Tags'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='overlay',
            name='stack',
            field=models.ForeignKey(to='catmaid.Stack'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='log',
            name='project',
            field=models.ForeignKey(to='catmaid.Project'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='log',
            name='user',
            field=models.ForeignKey(to=settings.AUTH_USER_MODEL),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='location',
            name='project',
            field=models.ForeignKey(to='catmaid.Project'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='location',
            name='user',
            field=models.ForeignKey(to=settings.AUTH_USER_MODEL),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='dataview',
            name='data_view_type',
            field=models.ForeignKey(to='catmaid.DataViewType'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='connectorclassinstance',
            name='project',
            field=models.ForeignKey(to='catmaid.Project'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='connectorclassinstance',
            name='relation',
            field=models.ForeignKey(to='catmaid.Relation'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='connectorclassinstance',
            name='user',
            field=models.ForeignKey(to=settings.AUTH_USER_MODEL),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='connector',
            name='project',
            field=models.ForeignKey(to='catmaid.Project'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='connector',
            name='user',
            field=models.ForeignKey(to=settings.AUTH_USER_MODEL),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='concept',
            name='project',
            field=models.ForeignKey(to='catmaid.Project'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='concept',
            name='user',
            field=models.ForeignKey(to=settings.AUTH_USER_MODEL),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='classinstanceclassinstance',
            name='project',
            field=models.ForeignKey(to='catmaid.Project'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='classinstanceclassinstance',
            name='relation',
            field=models.ForeignKey(to='catmaid.Relation'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='classinstanceclassinstance',
            name='user',
            field=models.ForeignKey(to=settings.AUTH_USER_MODEL),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='classinstance',
            name='project',
            field=models.ForeignKey(to='catmaid.Project'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='classinstance',
            name='user',
            field=models.ForeignKey(to=settings.AUTH_USER_MODEL),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='classclass',
            name='project',
            field=models.ForeignKey(to='catmaid.Project'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='classclass',
            name='relation',
            field=models.ForeignKey(to='catmaid.Relation'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='classclass',
            name='user',
            field=models.ForeignKey(to=settings.AUTH_USER_MODEL),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='class',
            name='project',
            field=models.ForeignKey(to='catmaid.Project'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='class',
            name='user',
            field=models.ForeignKey(to=settings.AUTH_USER_MODEL),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='changerequest',
            name='connector',
            field=models.ForeignKey(to='catmaid.Connector'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='changerequest',
            name='project',
            field=models.ForeignKey(to='catmaid.Project'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='changerequest',
            name='recipient',
            field=models.ForeignKey(related_name='change_recipient', db_column=b'recipient_id', to=settings.AUTH_USER_MODEL),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='changerequest',
            name='treenode',
            field=models.ForeignKey(to='catmaid.Treenode'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='changerequest',
            name='user',
            field=models.ForeignKey(to=settings.AUTH_USER_MODEL),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='cardinalityrestriction',
            name='project',
            field=models.ForeignKey(to='catmaid.Project'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='cardinalityrestriction',
            name='restricted_link',
            field=models.ForeignKey(to='catmaid.ClassClass'),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='cardinalityrestriction',
            name='user',
            field=models.ForeignKey(to=settings.AUTH_USER_MODEL),
            preserve_default=True,
        ),
        migrations.AddField(
            model_name='brokenslice',
            name='stack',
            field=models.ForeignKey(to='catmaid.Stack'),
            preserve_default=True,
        ),
    ]
