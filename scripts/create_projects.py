#!/usr/bin/python

# This is a small helper script to create a project, its stacks
# and add the required database entries to enable tracing of a
# the project with skeletons, connectors, etc.

# You may need to install psycopg2, e.g. with:
#	sudo apt-get install python-psycopg2

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

# Structure to keep info about stacks
class StackInfo:
	def __init__(self, name, dim, res, url, metadata=""):
		self.name = name
		self.dim = dim
		self.res = res
		self.metadata = metadata
		self.comment = ''
		self.base_url = url
		self.file_ext = 'jpg'
		self.num_zoom_levels = 3

	def __cmp__(self, other):
		return cmp(self.name, other.name)

	def __str__(self):
		return "Stack: " + self.name + " dim: " + self.dim + " res: " + self.res + " url: " + self.base_url
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

# Get fiter
filter_term = raw_input("Please add additional filters if you want (default: *): ")
if filter_term == "":
	filter_term = "*"

# Should only unknown projects be added?
only_unknown_projects = raw_input("Should only unknown projets be added? [y]/n: ")
if only_unknown_projects in ('n', 'no', 'nop', 'nope'):
	print "\t*All* projects will be added."
	only_unknown_projects = False
else:
	print "\tOnly unknown projects will be added."
	only_unknown_projects = True

# Get all matching stack folders
def find_files( path, depth=1 ):
	dirs = []
	for currentFile in glob.glob( os.path.join(path, filter_term) ):
		if os.path.isdir(currentFile):
			infoFile = os.path.join(currentFile, "info.yml")
			if os.path.exists(infoFile):
				dirs.append(currentFile)
			elif depth > 1:
				dirs = dirs + find_files( currentFile, depth - 1)
	return dirs

stack_dirs = find_files(data_dir, 2)

# Find projects among stacks
projects = {}
projectNames = {}
for stack in stack_dirs:
		folderName = stack.replace(data_dir, "")
		dim = ""
		res = ""
		name = ""
		url = base_url + data_dir + folderName + "/"
		# Optionally, check if this folder is already known
		if only_unknown_projects:
			select = 'SELECT id FROM stack WHERE image_base=\'' + url + '\''
			c.execute(select)
			rows = c.fetchall()
			if len(rows) > 0:
					print("\tSkipping: " + url)
					continue
		# Try to load info.yml of stack
		infoPath = data_dir + folderName  + "/info.yml"
		all_metadata = {}
		try:
			info = yaml.load(open(infoPath))
			dim = info['dimension']
			res = info['resolution']
			name = info['name']
			# Read out meta data, expect max. four channels
			all_metadata[0] = info['metadata-ch0'] if'metadata-ch0' in info else ""
			all_metadata[1] = info['metadata-ch1'] if'metadata-ch1' in info else ""
			all_metadata[2] = info['metadata-ch2'] if'metadata-ch2' in info else ""
			all_metadata[3] = info['metadata-ch3'] if'metadata-ch3' in info else ""
		except:
			print >> sys.stderr, "Could not read info.yml of stack " + stack
			sys.exit(1)
		stack_name = folderName
		metadata = ""
		# Rename stack if requested and choose correct meta data
		if stack_name.endswith("-ch1"):
			metadata = all_metadata[0]
			if simplify_stack_names:
				stack_name = "Channel 1"
		elif stack_name.endswith("-ch2"):
			metadata = all_metadata[1]
			if simplify_stack_names:
				stack_name = "Channel 2"
		elif stack_name.endswith("-ch3"):
			metadata = all_metadata[2]
			if simplify_stack_names:
				stack_name = "Channel 3"
		elif stack_name.endswith("-ch4"):
			metadata = all_metadata[3]
			if simplify_stack_names:
				stack_name = "Channel 4"
		elif stack_name.endswith("-composite"):
			if simplify_stack_names:
				stack_name = "Composite"
		# Create new stack info and add it to project
		si = StackInfo(stack_name, dim, res, url, metadata)
		projectId = folderName[:folderName.rfind("-")]
		if projectId not in projects:
			projects[projectId] = []
		projects[projectId].append(si)
		# Remember the name for the project if not already there
		if projectId not in projectNames:
			projectNames[projectId] = name

if len(projects) == 0:
		print("No valid projects found -- exiting")
		sys.exit(1)

print("Found the following projects:")
for p in projects:
	projects[p].sort()
	print 'projec: ' + p + " -- title: " + projectNames[p]
	for s in projects[p]:
		print '\t' + str(s)

# Check if this configuration is okay
projects_okay = raw_input("Should this project-stacks configuration be used? [y]/n: ")
if projects_okay in ('n', 'no', 'nop', 'nope'):
	print "Aborting on user request."
	sys.exit(1)

## Check if all other projects/stacks should be deleted first from the DB
#clear_db = raw_input("Should *all* previous projects and stacks be removed first from the DB? y/[n]: ")
#if clear_db in ('y', 'yes', 'yo', 'ja', 'jo'):
#	print "\tWill remove all previous projects and stacks from the DB."
#	clear_db = True
#else:
#	print "\tWill _not_ emove all previous projects and stacks from the DB."
#	clear_db = False

# Check if the projects should be public
projects_public = raw_input("Should these projects be public? [y]/n: ")
if projects_public in ('n', 'no', 'nop', 'nope'):
	print "\tProjects will _not_ be public."
	projects_public = "FALSE"
else:
	print "\tProjects will be public."
	projects_public = "TRUE"

# Group name
groupname = raw_input("Insert the group name that should get access to selected projects: ")
select = 'SELECT g.id FROM "auth_group" g WHERE g.name = %s'
c.execute(select, (groupname,) )
row = c.fetchone()
if not row:
	print >> sys.stderr, "Group name " + groupname + " does not exist in the database"
	sys.exit(1)
else:
	group_id = int(row[0])

# Get the content type id for CATMAID projets
select = 'SELECT ct.id FROM "django_content_type" ct WHERE ct.name = %s AND ct.app_label = %s AND model = %s'
c.execute( select, ("project", "catmaid", "project") )
row = c.fetchone()
if not row:
	print >> sys.stderr, "Could not find content type ID for CATMAID projects. Exiting."
	sys.exit(1)
else:
	content_type_id = str(row[0])
	print( "Found content type ID for CATMAID projects: " + content_type_id )

# Ask for permissions to add
select = 'SELECT ap.id, ap.name FROM "auth_permission" ap WHERE ap.content_type_id = %s'
c.execute( select, ( content_type_id, ) )
rows = c.fetchall()
if not row:
	print >> sys.stderr, "Could not find permission options for CATMAID projects. Exiting."
	sys.exit(1)
else:
	print( "Please select the permissions you want to grant to the group:" )
	for n, r in enumerate(rows):
		print( str(n) + ") " + r[1] )
	# Get a list of wanted permissions
	permissions = raw_input( "Insert all permissions as comma seperated list (e.g. 1,2,3): " )
	permissions = permissions.replace(" ", "").split(",")
	permissions = [rows[int(p)][0] for p in permissions]
	if len(permissions) == 0:
		print( "Could not understand your permission selection list. Exiting." )
		sys.exit(1)
	print( "Using the following permission ids: " + str(permissions) )

# Add all projects and stacks
for p in projects:
	# Add project
	name = projectNames[p]
	insert = 'INSERT INTO project (title, public) VALUES (%s, %s) RETURNING id'
	c.execute( insert, (name, projects_public) )
	project_id = c.fetchone()[0]
	print 'Added project ' + p + ' -- it got ID ' + str(project_id)

	# Add permissions
	for permission_id in permissions:
		ggp_select = 'SELECT ggp.id FROM "guardian_groupobjectpermission" ggp WHERE '
		ggp_select += 'ggp.permission_id = %s AND ggp.content_type_id = %s AND ggp.object_pk = %s AND group_id = %s'
		c.execute( ggp_select, (permission_id, content_type_id, str(project_id), group_id) )
		rows = c.fetchall()
		if len(rows) > 0:
			print( "Permissions already exist on project \"" + projects[project_id] + "\" (ID: " + str(project_id) + ")")
		else:
			insert = 'INSERT INTO guardian_groupobjectpermission (permission_id, content_type_id, object_pk, group_id) '
			insert += 'VALUES (%s, %s, %s, %s)'
			c.execute( insert, (permission_id, content_type_id, str(project_id), group_id) )
			print( "Modified permissions on project \"" + name + "\" (ID: " + str(project_id) + ")")

	# Add stacks
	for s in projects[p]:
		insert = 'INSERT INTO stack (title, dimension, resolution, image_base, comment, file_extension, num_zoom_levels, metadata) '
		insert += 'VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id'
		c.execute( insert, (s.name, s.dim, s.res, s.base_url, s.comment, s.file_ext, s.num_zoom_levels, s.metadata) )
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
