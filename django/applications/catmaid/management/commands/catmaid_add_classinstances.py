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

class Command(NoArgsCommand):
    help = "Generate 'cytoplamsic many small' instances as default."

    option_list = NoArgsCommand.option_list + (
        make_option('--user', dest='user_id', help='The ID of the who owns the class instances'),
        )

    def add_manysmall_ci(self, parent, klass):
        # Create a new class instance for this node
        ci = ClassInstance(user=self.user,name=klass.class_name)
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

    def check_morphology(self, root, mname, double_link):
        # Get all are morphology entries reachable from root
        if double_link:
            mci = ClassInstanceClassInstance.objects.filter(
                project=self.workspace_pid,
                class_instance_a__class_column__class_name=mname,
                class_instance_b__cici_via_a__class_instance_b__cici_via_a__class_instance_b=root)
        else:
            mci = ClassInstanceClassInstance.objects.filter(
                project=self.workspace_pid,
                class_instance_a__class_column__class_name=mname,
                class_instance_b__cici_via_a__class_instance_b=root)
        # Group the found instances by parent
        parents = {}
        for cici in mci:
            if cici.class_instance_b not in parents:
                parents[cici.class_instance_b] = []
            parents[cici.class_instance_b].append(
                cici.class_instance_a)
        # Test if one parent has more than one instance of
        # the current type
        for p in parents:
            if len(parents[p]) > 1:
                print("\tMore than one instance: %s" % (p,))

        return parents

    def set_defaults_standard_root(self, root, simulate=False, double_link=False):
        print("Checking " + root.name)
        fewlarge = self.check_morphology(root, "cytoplasmic few large", double_link) 
        manysmall = self.check_morphology(root, "cytoplasmic many small", double_link) 
        cortical = self.check_morphology(root, "cortical", double_link)
        # Find all possible parents
        parents = []
        for p in fewlarge:
            if p not in parents:
                parents.append(p)
        for p in manysmall:
            if p not in parents:
                parents.append(p)
        for p in cortical:
            if p not in parents:
                parents.append(p)
        # Iterate over all parents
        added_cis = []
        for p in parents:
            has_fewlarge = p in fewlarge
            has_manysmall = p in manysmall
            has_cortical = p in cortical
            print_data = (has_fewlarge, has_manysmall, has_cortical)
            print("\tFew large: %s Many small: %s Cortical %s" % (print_data))
            # Add 'many small' if needed
            if (has_fewlarge or has_cortical) and not has_manysmall:
                # Get the many small class
                manysmall_c = Class.objects.get(project=self.workspace_pid,
                    class_name='cytoplasmic many small')
                # Expect the existing morphology instances to have only one parent
                if not simulate:
                    self.add_manysmall_ci(p, manysmall_c)
                added_cis.append(p.id)

        if len(added_cis) > 0:
            print("\tAdded 'many small' to CI ids: " + str(added_cis))

    def set_defaults_standard_tissue(self, name, class_name, simulate=False, double_link=False):
        print("-----------------\n%s\n-----------------" % name)
        roots = ClassInstance.objects.filter(project=self.workspace_pid,
            class_column__class_name=class_name)
        for root in roots:
            self.set_defaults_standard_root(root, simulate, double_link)

    def set_defaults_fat_body(self, simulate=False):
        self.set_defaults_standard_tissue("Fat Body",
            "fat body classification", simulate, False)

    def set_defaults_testis(self, simulate=False):
        self.set_defaults_standard_tissue("Testis",
            "testis classification", simulate, False)

    def set_defaults_salivary_gland(self, simulate=False):
        self.set_defaults_standard_tissue("Salivary Gland",
            "salivary gland classification", simulate, False)

    def set_defaults_cns(self, simulate=False):
        self.set_defaults_standard_tissue("CNS",
            "CNS classification", simulate, False)

    def set_defaults_wing_disc(self, simulate=False):
        self.set_defaults_standard_tissue("Wing Disc",
            "wing disc classification", simulate, True)

    def set_defaults_ovaries(self, simulate=False):
        self.set_defaults_standard_tissue("Ovary",
            "ovary classification", simulate, True)

    def handle_noargs(self, **options):
        """ This is the main entry point.
        """
        # Get user to associate with new entities
        if not options['user_id']:
            raise CommandError, "You must specify a user ID with --user"
        self.user = User.objects.get(pk=options['user_id'])

        # Select the dummy project as workspace (work project
        # independent)
        self.workspace_pid = settings.ONTOLOGY_DUMMY_PROJECT_ID

        # Go through all tissues
        simulate = False
        self.set_defaults_fat_body(simulate)
        self.set_defaults_testis(simulate)
        self.set_defaults_salivary_gland(simulate)
        self.set_defaults_cns(simulate)
        self.set_defaults_wing_disc(simulate)
        self.set_defaults_ovaries(simulate)

        print("Done")
