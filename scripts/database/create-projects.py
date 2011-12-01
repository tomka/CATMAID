#!/usr/bin/python

# This is a small helper script to create a project, its stacks
# and add the required database entries.
#
# You may need to install psycopg2, e.g. with:
#	sudo apt-get install python-psycopg2
#
# This script reads all configuration files it can find in the
# data folder (based on an optional filter, defaulting to all
# files ending with ".yaml"). A configuration file is a YAML
# file that looks e.g. like this:
#
# project:
#   name: "Crb - Salivary Gland"
#   dimension: (3886,3893,55)
#   resolution: (138.0,138.0,1.0)
# ---
# stack:
#   folder: Rab1_SG1-ch1
#   name: Channel 1
#   metadata: "PMT Offset: 10, Laser Power: 0.5, PMT Voltage: 550"
# ---
# stack:
#   folder: Rab1_SG1-ch2
#   dimension: (3886,3893,55)
#   resolution: (138.0,138.0,1.0)
#   name: Channel 2
#   metadata: "PMT Offset: 10, Laser Power: 0.7, PMT Voltage: 500"
#
# The script also requires the file .catmaid-db to be present
# in your home directory, with the following format:
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

# Should the tool offer the clearing of the DB. This is
# potentially dangerous, therefore id has to be enabled
# here first.
ask_for_db_clearing = True

if len(sys.argv) != 2:
	print >> sys.stderr, "Usage: create-projects.py <base_url>"
	print >> sys.stderr, "\n<base_url> -- the URL to prepend the data folder with (both together are the image base)"
	print >> sys.stderr, "              e.g.: http://my.server.org/catmaid/"
	sys.exit(1)

# The base URL will be prepended to the data folder
base_url = sys.argv[1]

conn = psycopg2.connect(host=conf['host'], database=conf['database'],
						user=conf['username'], password=conf['password'])

#
# Structures to keep info about stacks and projects
#

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

class Project:
	def __init__( self, name, folder ):
		self.name = name
		self.folder = folder
		self.stacks = []

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
data_dir = raw_input("Data folder (a project folder or a folder containing project folders): ")
if data_dir[len(data_dir)-1] != "/":
	data_dir = data_dir + "/"
if not os.path.isdir(data_dir):
	print >> sys.stderr, "The given directory was not found"
	sys.exit(1)
else:
	print "\tUsing directory: " + data_dir

# Get fiter
filter_term = raw_input("Please add additional filters if you want (default: *.yaml$): ")
if filter_term == "":
	filter_term = "*"

# Should only unknown projects be added?
only_unknown_projects = raw_input("Should only unknown projets be added? [y]/n: ")
if only_unknown_projects in ('n', 'no', 'nop', 'nope'):
	print "\t*All* projects will be added (without checking for duplicates)."
	only_unknown_projects = False
else:
	print "\tOnly unknown projects will be added."
	only_unknown_projects = True

## Get all matching project files
project_files = []
# Check if the sub-folders are project directories
for currentFile in glob.glob( os.path.join(data_dir, filter_term) ):
	if os.path.isfile( currentFile ):
		project_files.append( currentFile )

# Find projects
projects = []
for pfile in project_files:
		print( "Looking at project file: " + pfile )
		project = None
		# Try to load project file
		try:
			project_folder = os.path.dirname( pfile )
			project_res = None
			project_dim = None
			# We expect more than one document within the project file
			p = yaml.load_all( open( pfile, 'r' ) )

			# Look for the project definition
			stacks = []
			for doc in p:
				if 'project' in doc:
					if project is not None:
						raise StandardError( "Found more than one project definition" )
					pdata = doc['project']
					project = Project( pdata['name'], project_folder )
					project_res = pdata['resolution'] if 'resolution' in pdata else None
					project_dim = pdata['dimension'] if 'dimension' in pdata else None
				elif 'stack' in doc:
					stacks.append( doc['stack'] )
				else:
					print( "\tDon't know document type -- ignoring it. This is what I found:\n" + str(doc) )
			if project is None:
				raise StandardError( "Couldn't find project definition" )
			else:
				print( "\tProject: " + project.name )

			# Look at the stacks (after having project created)
			for stack in stacks:
				# Get all the stack info
				folder = stack['folder']
				name = stack['name']
				metadata = stack['metadata'] if 'metadata' in stack else ""

				# Make sure the stack folder exists
				stack_path = os.path.join( project_folder, folder )
				if not stack_path.endswith("/"):
					stack_path = stack_path + "/"
				if not os.path.exists( stack_path ):
					raise StandardError( "Could not find stack folder: " + stack_path )

				# Make sure we got dimension and resolution information
				dim = stack['dimension'] if 'dimension' in stack else project_dim
				res = stack['resolution'] if 'resolution' in stack else project_res
				if dim is None or res is None:
					raise StandardError( "Dimension and resolution info not found in stack nor project definition" )

				url = base_url + stack_path

				# Optionally, check if this folder is already known
				if only_unknown_projects:
					select = 'SELECT id FROM stack WHERE image_base=\'' + url + '\''
					c.execute(select)
					rows = c.fetchall()
					if len(rows) > 0:
						print("\tSkipping: " + url)
						continue

				# Create new stack info and add it to project
				si = StackInfo( name, dim, res, url, metadata)
				project.stacks.append( si )
		except Exception, e:
			print >> sys.stderr, "Could not read project file: " + pfile + "\nError: " + str(e)
			sys.exit(1)

		# If the project doesn't contain any stacks, ignore the project
		if len( project.stacks ) == 0:
			print( "\tNo valid stacks in project -- skipping it" )
			continue

		# Remember the new project
		projects.append( project )

if len(projects) == 0:
        print("No valid projects found -- exiting")
        sys.exit(1)

print("Found the following projects:")
for p in projects:
	p.stacks.sort()
	print 'projec: ' + p.folder + " -- title: " + p.name
	for s in p.stacks:
		print '\t' + str(s)

# Check if this configuration is okay
projects_okay = raw_input("Should these project-stacks configurations be used? [y]/n: ")
if projects_okay in ('n', 'no', 'nop', 'nope'):
	print "Aborting on user request."
	sys.exit(1)

if ask_for_db_clearing:
	## Check if all other projects/stacks should be deleted first from the DB
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

# Ask if all users should be linked to the projects
link_to_all_users = raw_input("Do you want all users to be linked to the projects? [y]/n: ")
if link_to_all_users in ('n', 'no', 'nop', 'nope'):
	print "\tProjects will *not* be linked to all users."
	link_to_all_users = False
else:
	print "\tProjects will be linked to all users."
	link_to_all_users = True

# Usernames to be linked to the projects
linked_users = {}
if link_to_all_users:
	select = 'SELECT u.id, u.name FROM "user" u'
	c.execute( select )
	rows = c.fetchall()
	if len( rows ) == 0:
		print >> sys.stderr, "No users found. Aborting"
		sys.exit( 1 )
	for r in rows:
		linked_users[ r[1] ] = r[0]
else:
	linked_users_input = True
	# Ask for the users to be linked to the project and check if names exist
	while not linked_users:
		users = raw_input("What are the users that should be linked to the project? ")
		if users == "":
			print "\tProject will only be linked to user \"" + username + "\""
			users = []
		else:
			users = users.split(',')
		if username not in users:
			users.append( username )
		accepted = raw_input("The project will be linked to the following " + str(len(users)) + " users " + ', '.join( users ) + " -- alright? [y]/n: ")
		linked_users_input = accepted in ('n', 'no', 'nop', 'nope')
		if not linked_users_input:
			# Get the user ids
			for u in users:
				select = 'SELECT u.id FROM "user" u WHERE u.name = %s'
				c.execute(select, (u,) )
				row = c.fetchone()
				if not row:
					print >> sys.stderr, "Username " + u + " does not exist in the database"
					linked_users_input = True
				else:
					linked_users[u] = row[0]

# Clear DB if requested
if ask_for_db_clearing and clear_db:
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
	insert = 'INSERT INTO project (title, public) VALUES (%s, %s) RETURNING id'
	c.execute( insert, (p.name, projects_public) )
	project_id = c.fetchone()[0]
	print 'Added project ' + p.name + ' -- it got ID ' + str(project_id)
	# Link users to project
	for u in linked_users:
		insert = 'INSERT INTO project_user (project_id, user_id) '
		insert += 'VALUES (%s, %s)'
		c.execute( insert, (project_id, linked_users[u]) )
		print '\tlinked it to user ' + u + ' with ID ' + str(linked_users[u])
	# Add stacks
	for s in p.stacks:
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
