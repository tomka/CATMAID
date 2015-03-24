import os
import catmaid

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from catmaid.models import Project
from optparse import make_option


class Command(BaseCommand):
    args = '<project_id>'
    help = 'Prunes skeletons in the specified projects. All unreferenced ' \
        'nodes that are colinear with their child and parent will be removed'
    option_list = BaseCommand.option_list + (
        make_option('--dryrun',
            action='store_true',
            dest='dryrun',
            default=False,
            help='Don\'t actually remove nodes'),
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if not args:
            raise CommandError('Please specify at least one project ID as argument')

        # Check arguments
        dryrun = options['dryrun']

        if dryrun:
            self.stdout.write('DRY RUN - no changes will be made')
        else:
            self.stdout.write('This will make changes to the database')

        # Load PL/pgSQL pruning function from file
        app_path = os.path.dirname(catmaid.__file__)
        sql_path = os.path.join(app_path, 'sql/prune_skeletons.sql')
        with open(sql_path, 'r') as f:
            prune_sql = f.read()
        if not prune_sql:
            raise CommandError('Could not load required PL/pgSQL function from "%s"' % sql_path)

        # Load it into database
        cursor = connection.cursor()
        cursor.execute(prune_sql)
        self.stdout.write('Successfully loaded required PL/pgSQL functions')

        for project_id in args:
            try:
                project = Project.objects.get(pk=int(project_id))
                self.stdout.write('Starting pruning of all skeletons in project "%s"' % project.id)
                cursor.execute("SELECT * FROM prune_skeletons(%s, %s)", [project.id, dryrun])
                results = cursor.fetchone()
                num_deleted_nodes = results[0]
            except Project.DoesNotExist:
                raise CommandError('Project "%s" does not exist' % project_id)

            self.stdout.write('Deleted %s nodes in project "%s"' % (num_deleted_nodes, project.id))
            self.stdout.write('Successfully pruned all skeletons in project "%s"' % project.id)
