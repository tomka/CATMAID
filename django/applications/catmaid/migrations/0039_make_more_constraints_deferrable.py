# -*- coding: utf-8 -*-
# Generated by Django 1.11.13 on 2018-05-08 02:03
from __future__ import unicode_literals

import django.core.validators
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    """Make the foreign keys in different tables deferrable. This can be useful
    to data ingestion and import. It makes those constraints also more
    consistent with others.
    """

    dependencies = [
        ('catmaid', '0038_add_missing_initial_skeleton_summaries'),
    ]

    operations = [
        migrations.RunSQL("""
            -- Some older CATMAID instances seem to bot have the
            -- treenoded_skeleton_id constraint defined on the treenode table.
            -- Therefore, make sure it is available.
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT constraint_schema, constraint_name
                    FROM   information_schema.referential_constraints
                    WHERE  constraint_name = 'treenode_skeleton_id_fkey'
                )
                THEN
                    ALTER TABLE ONLY treenode
                    ADD CONSTRAINT treenode_skeleton_id_fkey FOREIGN KEY (skeleton_id)
                    REFERENCES class_instance(id) ON DELETE CASCADE;
                END IF;
            END $$;

            -- Update constraints
            ALTER TABLE location
            ALTER CONSTRAINT location_editor_id_fkey
            DEFERRABLE INITIALLY DEFERRED;

            ALTER TABLE location
            ALTER CONSTRAINT location_project_id_fkey
            DEFERRABLE INITIALLY DEFERRED;

            ALTER TABLE location
            ALTER CONSTRAINT location_user_id_fkey
            DEFERRABLE INITIALLY DEFERRED;

            ALTER TABLE treenode
            ALTER CONSTRAINT treenode_skeleton_id_fkey
            DEFERRABLE INITIALLY DEFERRED;

            ALTER TABLE region_of_interest
            ALTER CONSTRAINT region_of_interest_stack_id_fkey1
            DEFERRABLE INITIALLY DEFERRED;

            ALTER TABLE treenode_connector
            ALTER CONSTRAINT treenode_connector_connector_id_fkey
            DEFERRABLE INITIALLY DEFERRED;

            ALTER TABLE treenode_connector
            ALTER CONSTRAINT treenode_connector_treenode_id_fkey
            DEFERRABLE INITIALLY DEFERRED;
        """,
        """
            ALTER TABLE location
            ALTER CONSTRAINT location_editor_id_fkey
            NOT DEFERRABLE INITIALLY IMMEDIATE;

            ALTER TABLE location
            ALTER CONSTRAINT location_project_id_fkey
            NOT DEFERRABLE INITIALLY IMMEDIATE;

            ALTER TABLE location
            ALTER CONSTRAINT location_user_id_fkey
            NOT DEFERRABLE INITIALLY IMMEDIATE;

            ALTER TABLE treenode
            ALTER CONSTRAINT treenode_skeleton_id_fkey
            NOT DEFERRABLE INITIALLY IMMEDIATE;

            ALTER TABLE region_of_interest
            ALTER CONSTRAINT region_of_interest_stack_id_fkey1
            NOT DEFERRABLE INITIALLY IMMEDIATE;

            ALTER TABLE treenode_connector
            ALTER CONSTRAINT treenode_connector_connector_id_fkey
            NOT DEFERRABLE INITIALLY IMMEDIATE;

            ALTER TABLE treenode_connector
            ALTER CONSTRAINT treenode_connector_treenode_id_fkey
            NOT DEFERRABLE INITIALLY IMMEDIATE;
        """)
    ]