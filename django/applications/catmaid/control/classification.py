import json
import string

from django.conf import settings
from django import forms
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.template import Context, loader, Template

from catmaid.models import *
from catmaid.control.authentication import *
from catmaid.control.common import *
from catmaid.transaction import *

def get_classification_root_node_ids( dummy_project_id=-1):
    """ Returns a list with IDs of all classes that are connected
    with a IS_A relation to to the 'classification_root' class.
    """
    root_class = Class.objects.filter(class_name='classification_root',
        project_id=dummy_project_id)
    relation = Relation.objects.filter(relation_name='is_a',
        project_id=dummy_project_id)
    cc_relations = ClassClass.objects.filter(class_b = root_class,
        project_id=dummy_project_id, relation=relation)
    class_ids = [ o.class_a.id for o in cc_relations ]

    return class_ids

def get_classification_tree_number( project_id, dummy_project_id=-1 ):
    """ Returns the number of annotation trees, linked to a project.
    """
    class_ids = get_classification_root_node_ids( dummy_project_id )

    if len(class_ids) == 0:
        # If there are no root node classes, there can't be a tree
        return 0
    else:
        # Count the number of root nodes the current project has
        # instances of.
        root_node_q = ClassInstance.objects.filter(
            project=project_id,
            class_column__in=class_ids)
        return root_node_q.count()

@requires_user_role([UserRole.Annotate, UserRole.Browse])
@report_error
def classification_tree_number(request, project_id=None):
    num_trees = get_classification_tree_number( project_id )
    return HttpResponse(json.dumps(
        {'number_trees': num_trees}))

@requires_user_role([UserRole.Annotate, UserRole.Browse])
def classification_display(request, project_id=None):
    """ Creates a view that allows the user to create a new
    classification tree.
    """

    # First, check how many trees there are.
    num_trees = get_classification_tree_number( project_id )

    template_trees = AnnotationTreeTemplate.objects.all()

    context = Context({
        'num_trees': num_trees,
        'project_id': project_id,
        'CATMAID_DJANGO_URL': settings.CATMAID_DJANGO_URL
    })

    if num_trees == 0:
        NewClassificationForm = classification_form_factory()
        context['new_tree_form'] = NewClassificationForm()
        template = Template("""
        <p>There is currently no annotation tree associated with this
        project. Please create a new one if you like.</p>
        {% include "catmaid/new_classification_tree.html" %}""")
    elif num_trees == 1:
        template = loader.get_template( "catmaid/classification_tree.html" )
    else:
        template = Template("""
        <p>There are {{num_trees}} annotation trees associated
        with this project. Please select which one you want to display.
        </p>"
        """)

    return HttpResponse( template.render( context ) )

@requires_user_role([UserRole.Annotate, UserRole.Browse])
def remove_classification( request, project_id=None ):
    """ Removes the annotation tree of the project. All the class instances
    linked to the project and template tree links will get removed.
    """
    class_instances = ClassInstance.objects.filter(project=project_id)

    for ci in class_instances:
        ci.delete()

    return HttpResponse('The classification tree has been removed.')

def init_classification( user, project, root_class, dummy_project_id=-1 ):
    """ Initializes a classification for a project based on
    a particular template tree.
    ToDo: Maybe all this should be done in one transaction.
    """
    relation_map = get_relation_to_id_map(dummy_project_id)
    class_map = get_class_to_id_map(dummy_project_id)

    # Create needed classes for project: root + all of template

    if root_class.class_name not in class_map:
        raise CatmaidException("Couldn't find root class: %s" % root_class)

    root_class_id = class_map[root_class.class_name]

    # Create needed class_instances for project: root
    node = ClassInstance(user = user, name = "Root")
    node.project_id = project.id
    node.class_column_id = root_class_id
    node.save()
    # Remember this initalization in the log
    insert_into_log(project.id, user.id, "create_root", None, "Created root with ID %s" % node.id)

def classification_form_factory( dummy_project_id=-1 ):
    """ A factory method to create a classification form class.
    """
    class_ids = get_classification_root_node_ids( dummy_project_id )
    ontologies = Class.objects.filter(pk__in=class_ids)
    properties = {
       'template_tree' : forms.ModelChoiceField(
            queryset=ontologies)
    }

    return type('NewClassificationForm', (forms.Form,), properties)

@requires_user_role([UserRole.Annotate, UserRole.Browse])
def add_new_classification(request, project_id=None):
    # Has the form been submitted?
    NewClassificationForm = classification_form_factory()
    if request.method == 'POST':
        form = NewClassificationForm(request.POST)
        if form.is_valid():
            # Create the new classification tree
            project = get_object_or_404(Project, pk=project_id)
            template_tree = form.cleaned_data['template_tree']
            init_classification( request.user, project, template_tree )
            return HttpResponse('A new tree has been initalized.')
    else:
        form = NewClassificationForm()

    return render_to_response("catmaid/new_classification_tree.html", {
        "project_id": project_id,
        "new_tree_form": form,
    })

class ClassNode:
    """ Keeps the class instance ID, title, node type and
    template id as well as template childs of a node.
    """
    def __init__(self, id, title, class_name, class_id, node_type="element" ):
        self.id = id
        self.title = title
        self.class_name = class_name
        self.class_id = class_id
        self.node_type = node_type
        self.child_nodes = {}
        self.class_alt = []

def get_instance_children( parent_id, relation_map, max_nodes = 5000 ):
    """ Returns all children of a node with id <parent_id>. The result
    is limited to a maximum ef <max_nodes> nodes.
    """
    c = connection.cursor()
    # Must select the user as well because the user who created the skeleton may be differen
    # than the user who puts the request for the listing in the Object Tree.
    # TODO: Don't hard code the relation name. Get rather all available ones
    c.execute('''
            SELECT ci.id,
                   ci.name,
                   "auth_user".username AS username,
                   cl.class_name,
                   cl.id
            FROM class_instance AS ci
                INNER JOIN class_instance_class_instance AS cici
                ON ci.id = cici.class_instance_a
                INNER JOIN class AS cl
                ON ci.class_id = cl.id
                INNER JOIN "auth_user"
                ON ci.user_id = "auth_user".id
            WHERE cici.class_instance_b = %s
              AND (cici.relation_id = %s)
            ORDER BY ci.name ASC
            LIMIT %s''', (
        parent_id,
        relation_map['has_a'],
        max_nodes))

    # Collect all child node class instances
    child_nodes = []
    for row in c.fetchall():
        child = ClassNode(row[0], row[1], row[3], row[4])
        child_nodes.append( child )

    return child_nodes

def add_class_info( node, dummy_project_id=-1 ):
    """ Adds alternatives to the current node and all possible child nodes
    to the node.
    """
    
    # Get relation that identifies sub-types: is_a
    is_a = Relation.objects.filter(relation_name='is_a', project_id=dummy_project_id)

    # Add possible alternative classes
    parent_link = ClassClass.objects.filter(class_a_id=node.class_id, relation=is_a)
    if parent_link.count() == 1:
        parent_link = parent_link[0]
        parent = parent_link.class_b
    else:
        raise CatmaidException("Can not select parent of class '%s'" % node.class_name)

    # Get all sibling links from this parent
    sibling_links = ClassClass.objects.filter(class_b=parent_link.class_b, relation=is_a)
    # Add all possible alternative classes
    for sl in sibling_links:
        # Make sure we don't add our self
        if sl.class_a_id != node.class_id:
            node.class_alt.append(sl.class_a.class_name)

    # Get relation that identifies children: has_a
    has_a = Relation.objects.filter(relation_name='has_a', project_id=dummy_project_id)
    # Get all child nodes in class hierarchy
    child_links = ClassClass.objects.filter(class_a_id__in=[node.class_id, parent.id], relation=has_a)
    for cl in child_links:
        child = cl.class_b
        # Get possible sub-types of class
        child_types = ClassClass.objects.filter(class_b_id=child.id, relation=is_a)
        class_children = []
        for sub_type in child_types:
            class_children.append(sub_type.class_a.class_name)
        exclusive = False
        # Collect template tree child node properties
        node.child_nodes[child.id] = {
            'name': child.class_name,
            'class_names': class_children,
            'class_instances': [],
            'exclusive': exclusive,
            'rel_name': 'has_a'}

    return node

def add_instance_info( child_list, relation_map ):
    """ Adds template information to the child list. Concept
    information as well as instance information is added.
    """
    # Add basic template information
    # Get children of every children. This is needed to tell the user,
    # what options (s)he still has to alter the tree.
    for node in child_list:
        add_class_info( node )
        sub_children = get_instance_children( node.id, relation_map )
        for sub_child in sub_children:
            # Add this instance to the node
            instance_list = node.child_nodes[sub_child.class_id]['class_instances']
            instance_list.append( sub_child.class_name )

    return child_list

@requires_user_role([UserRole.Annotate, UserRole.Browse])
@report_error
def classification_list(request, project_id=None):
    parent_id = int(request.GET.get('parentid', 0))
    parent_name = request.GET.get('parentname', '')
    expand_request = request.GET.get('expandtarget', None)
    if expand_request is None:
        expand_request = tuple()
    else:
        # Parse to int to sanitize
        expand_request = tuple(int(x) for x in expand_request.split(','))

    max_nodes = 5000  # Limit number of nodes retrievable.
    dummy_project_id = -1

    relation_map = get_relation_to_id_map(dummy_project_id)
    class_map = get_class_to_id_map(dummy_project_id)

    # TODO: have this dynamic
    root_class = "testis_classification_root"

    if root_class not in class_map:
        raise CatmaidException("Can not find '%s' class for this project" % root_class)

    #for relation in ['model_of', 'part_of']:
    #    if relation not in relation_map:
    #        raise CatmaidException('Can not find "%s" relation for this project' % relation)

    # Find all the relations that are defined in it
    # ToDo: Maybe caching should be added
    relations = []

    response_on_error = ''
    try:
        if 0 == parent_id:
            response_on_error = 'Could not select the id of the root node'
            root_class_id = class_map[root_class]
            root_node_q = ClassInstance.objects.filter(
                project=project_id,
                class_column=root_class_id)

            if 0 == root_node_q.count():
                root_id = 0
                root_name = 'noname'
            else:
                root_node = root_node_q[0]
                root_id = root_node.id
                root_name = root_node.name

            # Collect all child node class instances
            child = ClassNode( root_id, root_name, root_class, root_class_id, 'root')
            add_instance_info( [child], relation_map )

            return HttpResponse(json.dumps([{
                'data': {'title': child.title},
                'attr': {'id': 'node_%s' % child.id,
                         'rel': child.node_type,
                         'classid': child.class_id,
                         'child_nodes': json.dumps(child.child_nodes)},
                'state': 'closed'}]))

        response_on_error = 'Could not retrieve child nodes.'

        child_nodes = get_instance_children( parent_id, relation_map )
        add_instance_info( child_nodes, relation_map )

        # TODO: When encountering a leaf node, "state" has to be omitted

        return HttpResponse(json.dumps(
                    tuple({'data': {'title': child.title },
                           'attr': {'id': 'node_%s' % child.id,
                                    'rel': child.node_type,
                                    'classid': child.class_id,
                                    'classname': child.class_name,
                                    'classalt': json.dumps(child.class_alt),
                                    'child_nodes': json.dumps(child.child_nodes)},
                           'state': 'open'} for child in child_nodes)))

    except Exception as e:
        raise CatmaidException(response_on_error + ':' + str(e))

@requires_user_role(UserRole.Annotate)
@transaction_reportable_commit_on_success
def classification_instance_operation(request, project_id=None):
    params = {}
    int_keys = ('id', 'src', 'ref', 'parentid', 'relationnr', 'classid')
    str_keys = ('title', 'operation', 'title', 'rel', 'classname', 'relationname', 'objname', 'targetname', 'newtype')
    for k in int_keys:
        params[k] = int(request.POST.get(k, 0))
    for k in str_keys:
        # TODO sanitize
        params[k] = request.POST.get(k, 0)

    dummy_project_id = -1

    relation_map = get_relation_to_id_map(dummy_project_id)
    class_map = get_class_to_id_map(dummy_project_id)

    # We avoid many try/except clauses by setting this string to be the
    # response we return if an exception is thrown.
    classification_instance_operation.res_on_err = ''

    def rename_node():
        """ Will rename a node.
        """
        can_edit_or_fail(request.user, params['id'], 'class_instance')
        # Do not allow '|' in name because it is used as string separator in NeuroHDF export
        if '|' in params['title']:
            raise CatmaidException('Name should not contain pipe character!')

        classification_instance_operation.res_on_err = 'Failed to update class instance.'
        nodes_to_rename = ClassInstance.objects.filter(id=params['id'])
        node_ids = [node.id for node in nodes_to_rename]
        if len(node_ids) > 0:
            nodes_to_rename.update(name=params['title'])
            insert_into_log(project_id, request.user.id, "rename_%s" % params['classname'], None, "Renamed %s with ID %s to %s" % (params['classname'], params['id'], params['title']))
            return HttpResponse(json.dumps({'class_instance_ids': node_ids}))
        else:
            raise CatmaidException('Could not find any node with ID %s' % params['id'])

    def retype_node():
        """ Will create a new class instance with the requested type to replace
        the current class instance.
        """
        can_edit_or_fail(request.user, params['id'], 'class_instance')
        nodes_to_retype = ClassInstance.objects.filter(id=params['id'])
        if len(nodes_to_retype) > 1:
            raise CatmaidException('Can only re-type one class instance at a time.')
        elif len(nodes_to_retype) == 0:
            raise CatmaidException('Could not find any node with ID %s' % params['id'])
        node = nodes_to_retype[0]
        new_type = params['newtype']

        # 1. Check if the retyping request is valid
        classification_instance_operation.res_on_err = 'Failed to re-type node with ID %s' % node.id
        # Is there a class for it?
        if new_type not in class_map:
            raise CatmaidException('No class found with name "%s".' % new_type)
        # Is there already a class instance named like this?
        parent = ClassInstance.objects.filter(id=params['parentid'])[0]
        cici_links = ClassInstanceClassInstance.objects.filter(class_instance_b=parent.id)
        for cici in cici_links:
            if cici.class_instance_a.class_column.class_name == new_type:
                raise CatmaidException('A class instance of type "%s" already exists.' % new_type)

        # 2. Assign new type name to class instance
        node.name = new_type
        node.class_column_id = class_map[new_type]
        node.save()

        return HttpResponse(json.dumps({'class_instance_id': node.id}))

    def remove_node():
        """ Will remove a node.
        """
        # Can only remove the node if the user owns it or the user is a superuser
        can_edit_or_fail(request.user, params['id'], 'class_instance')
        # Check if node is a skeleton. If so, we have to remove its treenodes as well!
        if 0 == params['rel']:
            CatmaidException('No relation given!')
        elif 'element' == params['rel']:

            def delete_node( node ):
                # Find and delete children
                classification_instance_operation.res_on_err = 'Failed to delete relation from instance table.'
                cici = ClassInstanceClassInstance.objects.filter(class_instance_b=node.id)
                for rel in cici:
                    # Delete children
                    delete_node( rel.class_instance_a )
                # Delete class instance
                node.delete()
                # Log
                insert_into_log(project_id, request.user.id, 'remove_element', None, 'Removed classification with ID %s and name %s' % (params['id'], params['title']))

            classification_instance_operation.res_on_err = 'Failed to select node from instance table.'
            node_to_delete = ClassInstance.objects.filter(id=params['id'])
            if node_to_delete.count() > 0:
                delete_node( node_to_delete[0] )
                return HttpResponse(json.dumps({'status': 1, 'message': 'Removed node successfully.'}))
            else:
                raise CatmaidException('Could not find any node with ID %s' % params['id'])
        else:
            classification_instance_operation.res_on_err = 'Failed to delete node from instance table.'
            node_to_delete = ClassInstance.objects.filter(id=params['id'])
            if node_to_delete.count() > 0:
                node_to_delete.delete()
                return HttpResponse(json.dumps({'status': 1, 'message': 'Removed node successfully.'}))
            else:
                raise CatmaidException('Could not find any node with ID %s' % params['id'])

    def create_node():
        # Can only create a node if the parent node is owned by the user
        # or the user is a superuser.
        # Given that the parentid is 0 to signal root (but root has a non-zero id),
        # this implies that regular non-superusers cannot create nodes under root,
        # but only in their staging area.
        can_edit_or_fail(request.user, params['parentid'], 'class_instance')

        if params['classname'] not in class_map:
            raise CatmaidException('Failed to select class.')
        classification_instance_operation.res_on_err = 'Failed to insert instance of class.'
        node = ClassInstance(
                user=request.user,
                name=params['objname'])
        node.project_id = project_id
        node.class_column_id = class_map[params['classname']]
        node.save()
        insert_into_log(project_id, request.user.id, "create_%s" % params['classname'], None, "Created %s with ID %s" % (params['classname'], params['id']))

        # We need to connect the node to its parent, or to root if no valid parent is given.
        node_parent_id = params['parentid']
        if 0 == params['parentid']:
            # Find root element
            classification_instance_operation.res_on_err = 'Failed to select root.'
            raise CatmaidException("Root selection not implemented yet.")
            node_parent_id = ClassInstance.objects.filter(
                    project=project_id,
                    class_column=class_map['root'])[0].id

        if params['relationname'] not in relation_map:
            CatmaidException('Failed to select relation %s' % params['relationname'])

        classification_instance_operation.res_on_err = 'Failed to insert relation.'
        cici = ClassInstanceClassInstance()
        cici.user = request.user
        cici.project_id = project_id
        cici.relation_id = relation_map[params['relationname']]
        cici.class_instance_a_id = node.id
        cici.class_instance_b_id = node_parent_id
        cici.save()

        return HttpResponse(json.dumps({'class_instance_id': node.id}))

    def has_relations():
        relations = [request.POST.get('relation%s' % i, 0) for i in range(int(params['relationnr']))]
        relation_ids = []
        for relation in relations:
            classification_instance_operation.res_on_err = 'Failed to select relation %s' % relation
            relation_ids.append(relation_map[relation])
        classification_instance_operation.res_on_err = 'Failed to select CICI.'
        relation_count = ClassInstanceClassInstance.objects.filter(
                project=project_id,
                class_instance_b=params['id'],
                relation__in=relation_ids).count()
        if relation_count > 0:
            return HttpResponse(json.dumps({'has_relation': 1}))
        else:
            return HttpResponse(json.dumps({'has_relation': 0}))

    try:
        # Dispatch to operation
        if params['operation'] not in ['rename_node', 'remove_node', 'create_node', 'move_node', 'has_relations', 'retype_node']:
            raise CatmaidException('No operation called %s.' % params['operation'])
        return locals()[params['operation']]()

    except CatmaidException:
        raise
    except Exception as e:
        raise CatmaidException(classification_instance_operation.res_on_err + '\n' + str(e))
