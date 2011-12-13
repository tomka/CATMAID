#!/usr/bin/python

# This is a small helper script to create a project, its stacks
# and add the required database entries to enable tracing of a
# the project with skeletons, connectors, etc.

# You may need to install psycopg2, e.g. with:
#   sudo apt-get install python-psycopg2

# Requires the file .catmaid-db to be present in your
# home directory, with the following format:
#
# host: localhost
# database: catmaid
# username: catmaid_user
# password: password_of_your_catmaid_user

import sys
import psycopg2
import os
import yaml
import glob

try:
    conf = yaml.load(open(os.path.join(os.environ['HOME'], '.catmaid-db')))
except:
    print >> sys.stderr, '''Your ~/.catmaid-db file should look like:

host: localhost
database: catmaid
username: catmaid_user
password: password_of_your_catmaid_user'''
    sys.exit(1)

limit = 50

# The base URL will be prpended to the data folder
base_url = 'http://rablibrary.mpi-cbg.de/catmaid/'
# Define if stack name substitution should be done
simplify_stack_names = True

if len(sys.argv) != 1:
    print >> sys.stderr, "Usage: create-projects.py"
    sys.exit(1)

conn = psycopg2.connect(host=conf['host'], database=conf['database'],
                        user=conf['username'], password=conf['password'])

# Helper function
def create_annotation(user_id, project_id):

    print("Create annotations for project with id {0} as user with id {1}".format(project_id, user_id) )
    classes_required = [ ( "skeleton", True ),
                         ( "neuron", True ),
                         ( "group", True ),
                         ( "label", False ),
                         ( "root", False ),
                         ( "synapse", True ),
                         ( "presynaptic terminal", True ),
                         ( "postsynaptic terminal", True ) ]

    class_dictionary = {}

    for required_class, show_in_tree in classes_required:
        class_dictionary[required_class] = {'show_in_tree': show_in_tree};
        c.execute("INSERT INTO class (user_id, project_id, class_name, showintree) "+
                  "VALUES (%s, %s, %s, %s) RETURNING id",
                  (user_id, project_id, required_class, show_in_tree))
        class_dictionary[required_class]['id'] = c.fetchone()[0]

    c.execute("INSERT INTO class_instance (user_id, project_id, class_id, name) "+
              "VALUES (%s, %s, %s, %s)",
              (user_id,
               project_id,
               class_dictionary['root']['id'],
               'neuropile'))

    relations_required = (
        "labeled_as",
        "postsynaptic_to",
        "presynaptic_to",
        "element_of",
        "model_of",
        "part_of",
        "is_a"
        )

    for required_relation in relations_required:
        c.execute("INSERT INTO relation (user_id, project_id, relation_name) "+
                  "VALUES (%s, %s, %s)",
                  (user_id, project_id, required_relation))

    print("Annotation classes and relations successfully created.")

# Structure to keep info about stacks
class StackInfo:
	def __init__(self, name, dim, res, url):
		self.name = name
		self.dim = dim
		self.res = res
		self.comment = ''
		self.base_url = url
		self.file_ext = 'jpg'

	def __cmp__(self, other):
		return cmp(self.name, other.name)

	def __str__(self):
		return "Stack: " + self.name + " dim: " + dim + " res: " + res + " url: " + self.base_url
#
# Start dialog
#
c = conn.cursor()

# Username
username = raw_input("What is your CATMAID user name: ")
select = 'SELECT u.id FROM "user" u WHERE u.name = %s'
c.execute(select, (username,) )
row = c.fetchone()
if not row:
    print >> sys.stderr, "Username does not exist in the database"
    sys.exit(1)
else:
    user_id = row[0]

# Stack selection
data_dir = raw_input("Data folder (with folder for each stack): ")
if data_dir[len(data_dir)-1] != "/":
	data_dir = data_dir + "/"
if not os.path.isdir(data_dir):
	print >> sys.stderr, "The given directory was not found"
	sys.exit(1)
else:
	print "Using directory: " + data_dir
stack_dirs = []
for currentFile in glob.glob( os.path.join(data_dir, '*') ):
	if os.path.isdir(currentFile):
		stack_dirs.append(currentFile)

# Find projects among stacks
projects = {}
projectNames = {}
for stack in stack_dirs:
		folderName = stack.replace(data_dir, "")
		dim = ""
		res = ""
		name = ""
		url = base_url + data_dir + folderName + "/"
		# Try to load info.yml of stack
		infoPath = data_dir + folderName  + "/info.yml"
		try:
			info = yaml.load(open(infoPath))
			dim = info['dimension']
			res = info['resolution']
			name = info['name']
		except:
			print >> sys.stderr, "Could not read info.yml of stack " + stack
			sys.exit(1)
		stack_name = folderName
		# Rename stack if requested
		if simplify_stack_names:
			if stack_name.endswith("-ch1"):
				stack_name = "Channel 1"
			elif stack_name.endswith("-ch2"):
				stack_name = "Channel 2"
			elif stack_name.endswith("-ch3"):
				stack_name = "Channel 3"
			elif stack_name.endswith("-ch4"):
				stack_name = "Channel 4"
			elif stack_name.endswith("-composite"):
				stack_name = "Composite"
		# Create new stack info and add it to project
		si = StackInfo(stack_name, dim, res, url)
		projectId = folderName[:folderName.rfind("-")]
		if projectId not in projects:
			projects[projectId] = []
		projects[projectId].append(si)
		# Remember the name for the project if not already there
		if projectId not in projectNames:
			projectNames[projectId] = name
for p in projects:
	projects[p].sort()
	print 'projec: ' + p
	for s in projects[p]:
		print '\t' + str(s)

# Check if this configuration is okay
projects_okay = raw_input("Should this project-stacks configuration be used? [y]/n: ")
if projects_okay in ('n', 'no', 'nop', 'nope'):
	print "Aborting on user request."
	sys.exit(1)

# Check if all other projects/stacks should be deleted first from the DB
clear_db = raw_input("Should *all* previous projects and stacks be removed first from the DB? y/[n]: ")
if clear_db in ('y', 'yes', 'yo', 'ja', 'jo'):
	print "\tWill remove all previous projects and stacks from the DB."
	clear_db = True
else:
	print "\tWill _not_ emove all previous projects and stacks from the DB."
	clear_db = False

# Check if the projects should be public
projects_public = raw_input("Should these projects be public? [y]/n: ")
if projects_public in ('n', 'no', 'nop', 'nope'):
	print "\tProjects will _not_ be public."
	projects_public = "FALSE"
else:
	print "\tProjects will be public."
	projects_public = "TRUE"

# Clear DB if requested
if clear_db:
	clear = "DELETE FROM project_user"
	c.execute( clear )
	print 'deleted project_user table'
	clear = "DELETE FROM project_stack"
	c.execute( clear )
	print 'deleted project_stack table'
	clear = "DELETE FROM project"
	c.execute( clear )
	print 'deleted project table'
	clear = "DELETE FROM stack"
	c.execute( clear )
	print 'deleted stack table'

# Add all projects and stacks
for p in projects:
	# Add project
	name = projectNames[p]
	insert = 'INSERT INTO project (title, public) VALUES (%s, %s) RETURNING id'
	c.execute( insert, (name, projects_public) )
	project_id = c.fetchone()[0]
	print 'Added project ' + p + ' -- it got ID ' + str(project_id)
	# Link user to project
	insert = 'INSERT INTO project_user (project_id, user_id) '
	insert += 'VALUES (%s, %s)'
	c.execute( insert, (project_id, user_id) )
	print '\tlinked it to user with ID ' + str(user_id)
	# Add stacks
	for s in projects[p]:
		insert = 'INSERT INTO stack (title, dimension, resolution, image_base, comment, file_extension) '
		insert += 'VALUES (%s, %s, %s, %s, %s, %s) RETURNING id'
		c.execute( insert, (s.name, s.dim, s.res, s.base_url, s.comment, s.file_ext) )
		stack_id = c.fetchone()[0]
		print '\tcreated new stack ' + s.name + ' with ID ' +str(stack_id)
		# Update the project_stack table
		insert = 'INSERT INTO project_stack (project_id, stack_id) '
		insert += 'VALUES (%s, %s)'
		c.execute( insert, (project_id, stack_id) )

conn.commit()
c.close()
conn.close()
print 'done'

sys.exit(1)
