#!/usr/bin/env python

# This is a small helper script to add the required database entries
# to enable tracing of a particular project with treelines,
# connectors, etc.  This should really be done in a larger project
# creation script.

# You may need to install psycopg2, e.g. with:
#   sudo apt-get install python-psycopg2

import sys
import psycopg2
import os
from common import db_connection

if len(sys.argv) != 3:
    print >> sys.stderr, "Usage: %s <PROJECT-ID> <USER-ID>" % (sys.argv[0])
    sys.exit(1)

project_id = int(sys.argv[1])
user_id = int(sys.argv[2])

c = db_connection.cursor()

classes_required = [ "annotation_term" ]

# classes_required = [ "skeleton",
#                      "neuron",
#                      "group",
#                      "label",
#                      "root" ]

# Keeps the ids of the required classes in the database
class_dictionary = {}

# Make sure all the required classes are available for
# the current project.
for required_class in classes_required:
    c.execute("SELECT id FROM class WHERE class_name = %s AND project_id = %s",
              (required_class, project_id))
    rows = c.fetchall()
    if len(rows) > 0:
        class_dictionary[required_class] = rows[0][0]
    else:
        c.execute("INSERT INTO class (user_id, project_id, class_name) "+
                  "VALUES (%s, %s, %s) RETURNING id",
                  (user_id, project_id, required_class))
        class_dictionary[required_class] = c.fetchone()[0]

# Get the root node
c.execute("SELECT id FROM class_instance WHERE class_id = %s AND project_id = %s",
    (class_dictionary['root'], project_id))
rows = c.fetchall()
if len(rows) > 0:
    print('The root node already exists!')
else:
    c.execute("INSERT INTO class_instance (user_id, project_id, class_id, name) "+
          "VALUES (%s, %s, %s, %s)",
          (user_id,
           project_id,
           class_dictionary['root'],
           'annotation tree'))

# A list of relations that are required for annotation trees
relations_required = (
    "labeled_as",
    "element_of",
    "model_of",
    "part_of",
    "is_a"
    )

# Make sure all the required relations exist in the database
for required_relation in relations_required:
    c.execute("SELECT id FROM relation WHERE relation_name = %s AND project_id = %s",
              (required_relation, project_id))
    rows = c.fetchall()
    if 0 == len(rows):
        c.execute("INSERT INTO relation (user_id, project_id, relation_name) "+
                  "VALUES (%s, %s, %s)",
                  (user_id, project_id, required_relation))

# Grant viewing and editing permissions to the user
c.execute("SELECT * FROM project_user WHERE user_id = %s AND project_id = %s", (str(user_id), project_id))
rows = c.fetchall()
if len(rows) == 0:
    print('Insert project-user combination and enable viewing and editing')
    c.execute("INSERT INTO project_user (project_id, user_id, can_edit_any, can_view_any, inverse_mouse_wheel) "+
              "VALUES (%s, %s, %s, %s, %s)", (project_id, user_id, True, True, True))
else:
    print('project-user combination already exists. Enable viewing and editing')
    c.execute("UPDATE project_user SET can_edit_any=TRUE, can_view_any=TRUE WHERE project_id=" + str(project_id)
		+ " AND user_id=" + str(user_id))

db_connection.commit()
c.close()
db_connection.close()
