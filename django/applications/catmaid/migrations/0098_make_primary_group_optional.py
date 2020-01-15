# Generated by Django 2.2.9 on 2020-01-15 15:38

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('catmaid', '0097_add_num_imported_nodes_to_summary_and_optimize_edge_update'),
    ]

    operations = [
        migrations.AlterField(
            model_name='userprofile',
            name='primary_group',
            field=models.ForeignKey(blank=True, default=None, null=True, on_delete=django.db.models.deletion.DO_NOTHING, to='auth.Group'),
        ),
    ]
