import logging

from catmaid import history

from django.apps import AppConfig
from django.conf import settings
from django.core.checks import Warning, register
from django.core.exceptions import ImproperlyConfigured
from django.db import connection
from django.db.utils import ProgrammingError
from django.db.models import signals
from django.db.backends import signals as db_signals
from django.contrib import auth
from django.contrib.auth.management.commands import createsuperuser

#from catmaid.control import project


def get_system_user():
    """Return a User instance of a superuser. This is either the superuser
    having the ID configured in SYSTEM_USER_ID or the superuser with the lowest
    ID."""
    User = auth.get_user_model()

    if hasattr(settings, "SYSTEM_USER_ID"):
        try:
            return User.objects.get(id=settings.SYSTEM_USER_ID, is_superuser=True)
        except User.DoesNotExist:
            raise ImproperlyConfigured("Could not find any super user with ID "
                                       "configured in SYSTEM_USER_ID (%s), "
                                       "please fix this in settings.py" % settings.SYSTEM_USER_ID)
    else:
        # Find admin user with lowest id
        users = User.objects.filter(is_superuser=True).order_by('id')
        if not len(users):
            raise ImproperlyConfigured("Couldn't find any super user, " +
                                       "please make sure you have one")
        return users[0]


def check_old_version(sender, **kwargs):
    """Make sure this migration system starts with all South migrations applied,
    in case there are already existing tables."""
    # Only validate after catmaid was migrated
    if type(sender) != CATMAIDConfig:
        return

    cursor = connection.cursor()

    def table_exists(name):
        cursor.execute("""
            SELECT EXISTS (
               SELECT 1
               FROM   information_schema.tables
               WHERE  table_schema = 'public'
               AND    table_name = %s
            );
        """, (name,))
        result = cursor.fetchone()
        return result[0]

    def catmaid_was_migrated():
        cursor.execute("""
           SELECT count(*) FROM django_migrations WHERE app = 'catmaid';
        """)
        result = cursor.fetchone()
        return result[0] > 0

    # Don't check for old the existing database state if Django 1.7 migrations
    # have been applied already.
    if table_exists("django_migrations") and catmaid_was_migrated():
        return

    # Check if there are existing CATMAID 2015.12.21 tables by testing if the
    # project table exists. If it does, expect that the result of the last South
    # migration (#61) was applied---the apikey table was removed. Fail if it
    # wasn't and tell the user to bring the database to this expected state.
    if table_exists("project") and table_exists("catmaid_apikey"):
        raise ImproperlyConfigured("Can not apply initial database migration. "
                "You seem to update from an existing CATMAID version. Please "
                "make sure this existing version was updated to version "
                "2015.12.21 (with all migrations applied) and then move on to "
                "the next version. Note that you have to fake the initial "
                "migration of the newer version, i.e. before you do the "
                "regular update steps call 'manage.py migrate --fake catmaid "
                "0001_initial'.")

def check_history_setup(app_configs, **kwargs):
    messages = []
    # Enable or disable history tracking, depending on the configuration.
    # Ignore silently, if the database wasn't migrated yet.
    if getattr(settings, 'HISTORY_TRACKING', True):
        run = history.enable_history_tracking(True)
    else:
        run = history.disable_history_tracking(True)

    if not run:
        messages.append(Warning(
            "Couldn't check history setup, missing database functions",
            hint="Migrate CATMAID"))
    return messages

def validate_environment(sender, **kwargs):
    """Make sure CATMAID is set up correctly."""
    # Only validate after catmaid was migrated
    if type(sender) != CATMAIDConfig:
        return

    sender.validate_projects()
    sender.init_classification()

class CATMAIDConfig(AppConfig):
    name = 'catmaid'
    verbose_name = "CATMAID"

    def ready(self):
        """Perform initialization for back-end"""
        self.validate_configuration()
        self.check_superuser()

        # Make sure the existing version is what we expect
        signals.pre_migrate.connect(check_old_version, sender=self)

        # Validate CATMAID environment after all migrations have been run
        signals.post_migrate.connect(validate_environment, sender=self)

        # Register history checks
        register(check_history_setup)

    # A list of settings that are expected to be available.
    required_setting_fields = {
        "VERSION": str,
        "CATMAID_URL": str,
        "ONTOLOGY_DUMMY_PROJECT_ID": int,
        "PROFILE_INDEPENDENT_ONTOLOGY_WORKSPACE_IS_DEFAULT": bool,
        "PROFILE_SHOW_TEXT_LABEL_TOOL": bool,
        "PROFILE_SHOW_TAGGING_TOOL": bool,
        "PROFILE_SHOW_CROPPING_TOOL": bool,
        "PROFILE_SHOW_SEGMENTATION_TOOL": bool,
        "PROFILE_SHOW_TRACING_TOOL": bool,
        "PROFILE_SHOW_ONTOLOGY_TOOL": bool,
        "PROFILE_SHOW_ROI_TOOL": bool,
        "ROI_AUTO_CREATE_IMAGE": bool,
        "NODE_LIST_MAXIMUM_COUNT": int,
        "IMPORTER_DEFAULT_TILE_WIDTH": int,
        "IMPORTER_DEFAULT_TILE_HEIGHT": int,
        "IMPORTER_DEFAULT_TILE_SOURCE_TYPE": int,
        "IMPORTER_DEFAULT_IMAGE_BASE": str,
        "MEDIA_HDF5_SUBDIRECTORY": str,
        "MEDIA_CROPPING_SUBDIRECTORY": str,
        "MEDIA_ROI_SUBDIRECTORY": str,
        "MEDIA_TREENODE_SUBDIRECTORY": str,
        "GENERATED_FILES_MAXIMUM_SIZE": int,
        "USER_REGISTRATION_ALLOWED": bool,
        "NEW_USER_DEFAULT_GROUPS": list,
        "STATIC_EXTENSION_FILES": list,
        "STATIC_EXTENSION_ROOT": str,
    }

    def validate_configuration(self):
        """Make sure CATMAID is configured properly and raise an error if not.
        """
        # Make sure all expected settings are available.
        for field, data_type in CATMAIDConfig.required_setting_fields.iteritems():
            if not hasattr(settings, field):
                raise ImproperlyConfigured(
                        "Please add the %s settings field" % field)
            if type(getattr(settings, field)) != data_type:
                raise ImproperlyConfigured("Please make sure settings field %s "
                        "is of type %s" % (field, data_type))

        # Make sure swagger (API doc) knows about a potential sub-directory
        if not hasattr(settings, 'SWAGGER_SETTINGS'):
            settings.SWAGGER_SETTINGS = {}
        if 'api_path' not in settings.SWAGGER_SETTINGS:
            settings.SWAGGER_SETTINGS['api_path'] = settings.CATMAID_URL


    def check_superuser(self):
        """Make sure there is at least one superuser available and, if configured,
        SYSTEM_USER_ID points to a superuser. Expects database to be set up.
        """
        try:
            User = auth.get_user_model()
            Project = self.get_model("Project")
            has_users = User.objects.all().exists()
            has_projects = Project.objects.exclude(pk=settings.ONTOLOGY_DUMMY_PROJECT_ID).exists()
            if not (has_users and has_projects):
                # In case there is no user and only no project except thei ontology
                # dummy project, don't do the check. Otherwise, setting up CATMAID
                # initially will not be possible without raising the errors below.
                return

            if not User.objects.filter(is_superuser=True).count():
                raise ImproperlyConfigured("You need to have at least one superuser "
                                        "configured to start CATMAID.")

            if hasattr(settings, "SYSTEM_USER_ID"):
                try:
                    user = User.objects.get(id=settings.SYSTEM_USER_ID)
                except User.DoesNotExist:
                    raise ImproperlyConfigured("Could not find any super user with the "
                                            "ID configured in SYSTEM_USER_ID")
                if not user.is_superuser:
                    raise ImproperlyConfigured("The user configured in SYSTEM_USER_ID "
                                            "is no superuser")
        except ProgrammingError:
            # This error is raised if the database is not set up when the code
            # above is executed. This can safely be ignored.
            pass

    def init_classification(self):
        """ Creates a dummy project to store classification graphs in.
        """
        Project = self.get_model("Project")
        try:
            Project.objects.get(pk=settings.ONTOLOGY_DUMMY_PROJECT_ID)
        except Project.DoesNotExist:
            logging.getLogger(__name__).info("Creating ontology dummy project")
            Project.objects.create(pk=settings.ONTOLOGY_DUMMY_PROJECT_ID,
                title="Classification dummy project")


    def validate_projects(self):
        """Make sure all projects have the relations and classes available they
        expect."""
        User = auth.get_user_model()
        Project = self.get_model("Project")
        has_users = User.objects.all().exists()
        has_projects = Project.objects.exclude(
            pk=settings.ONTOLOGY_DUMMY_PROJECT_ID).exists()
        if not (has_users and has_projects):
            # In case there is no user and only no project except thei ontology
            # dummy project, don't do the check. Otherwise, getting a system user
            # will fail.
            return

        user = get_system_user()
        for p in Project.objects.all():
            p.validate_project_setup(user.id)
