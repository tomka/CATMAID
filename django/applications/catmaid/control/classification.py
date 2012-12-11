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

def get_classification_tree_number( project_id ):
    """ Returns the number of annotation trees, linked to a project.
    """
    class_map = get_class_to_id_map(project_id)
    if 'root' not in class_map:
        num_trees = 0
    else:
        parent_id = 0
        root_node_q = ClassInstance.objects.filter(
            project=project_id,
            class_column=class_map['root'])
        num_trees = root_node_q.count()
    return num_trees

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
        'template_trees': template_trees,
        'project_id': project_id,
        'CATMAID_DJANGO_URL': settings.CATMAID_DJANGO_URL
    })

    if num_trees == 0:
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
        # Delete link to template node
        ClassInstanceAnnotationTreeTemplateNode.objects.filter(class_instance=ci.id)[0].delete()
        # Delete class instance
        ci.delete()

    template_tree_link = ProjectAnnotationTreeTemplate.objects.filter(project=project_id)
    template_tree_link.delete()

    return HttpResponse('The classification tree has been removed.')

def traverse_template_tree( node, method, level = 1 ):
    """ Traverses the given template tree and calls the
    given method for every node.
    """
    method( node )
    for child in node.children.all():
        traverse_template_tree( child, method, level + 1 )

def init_classification( user, project, template_tree ):
    """ Initializes a classification for a project based on
    a particular template tree.
    ToDo: Maybe all this should be done in one transaction.
    """
    relation_map = get_relation_to_id_map(project.id)
    class_map = get_class_to_id_map(project.id)

    # Create needed classes for project: root + all of template

    if 'root' not in class_map:
        root_class = Class(
                user = user,
                class_name = "root",
                description ="Root node")
        root_class.project_id = project.id
        root_class.save()
        root_class_id = root_class.id
    else:
        root_class_id = class_map['root']

    def add_class_names_and_relation( node ):
        """ Adds all the class names in this node to this project
        as well as the relation they should be linked to a parent.
        """
        # Class names
        for cn in node.class_names:
            # Add the class if it doesn't exist yet
            if cn not in class_map:
                new_class = Class(
                    user = user,
                    class_name = cn,
                    description = "")
                new_class.project_id = project.id
                new_class.save()
        # Add relation if it doesn't exist yet
        if node.relation_name not in relation_map:
            new_relation = Relation(
                user = user,
                relation_name = node.relation_name,
                uri = "",
                description = "",
                isreciprocal = False)
            new_relation.project_id = project.id
            new_relation.save()

    traverse_template_tree( template_tree.rootnode, add_class_names_and_relation )

    # Create needed class_instances for project: root
    node = ClassInstance(
            user = user,
            name = "Root")
    node.project_id = project.id
    node.class_column_id = root_class_id
    node.save()
    # Link the node to a template tree node
    ci_t_link = ClassInstanceAnnotationTreeTemplateNode()
    ci_t_link.class_instance_id = node.id
    ci_t_link.annotation_tree_template_node_id = template_tree.rootnode.id
    ci_t_link.save()
    # Link the template tree choice to the project
    p_t_link = ProjectAnnotationTreeTemplate()
    p_t_link.project_id = project.id
    p_t_link.annotation_tree_template_id = template_tree.id
    p_t_link.save()
    # Remember this initalization in the log
    insert_into_log(project.id, user.id, "create_root", None, "Created root with ID %s" % node.id)

class NewClassificationForm(forms.Form):
    """ A simple form to select template trees.
    """
    template_tree = forms.ModelChoiceField(
        queryset=AnnotationTreeTemplate.objects.all())

@requires_user_role([UserRole.Annotate, UserRole.Browse])
def add_new_classification(request, project_id=None):
    # Has the form been submitted?
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

class Child:
    """ Keeps the class instance ID, title, node type and
    template id as well as template childs of a node.
    """
    def __init__(self, id, title, class_name, node_type="element" ):
        self.id = id
        self.title = title
        self.class_name = class_name
        self.node_type = node_type
        self.child_nodes = {}
        self.template_node_id = -1
        self.template_node_name = ""
        self.template_node_alt = []

def get_children( parent_id, relation_map, max_nodes = 5000 ):
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
                   cl.class_name
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
        relation_map['part_of'],
        max_nodes))

    # Collect all child node class instances
    child_nodes = []
    for row in c.fetchall():
        child = Child(row[0], row[1], row[3])
        child_nodes.append( child )

    return child_nodes

def add_template_classes( child_list ):
    """ Adds all possible child nodes according to the each
    given node as attribute.
    """
    # Add all template node child nodes
    for node in child_list:
        # Get template tree nodes
        template_tree_node = ClassInstanceAnnotationTreeTemplateNode.objects.filter(
            class_instance=node.id)[0].annotation_tree_template_node
        node.template_node_id = template_tree_node.id
        node.template_node_name = template_tree_node.name
        # Add possible alternative types
        for sibling in template_tree_node.class_names:
            if sibling != node.class_name:
                node.template_node_alt.append(sibling)
        # Collect template tree child node properties
        for nc in template_tree_node.children.all():
            node.child_nodes[nc.id] = {
                'name': nc.name,
                'class_names': nc.class_names,
                'class_instances': [],
                'exclusive': nc.exclusive,
                'rel_name': nc.relation_name}

    return child_list

def add_template_fields( child_list, relation_map ):
    """ Adds template information to the child list. Concept
    information as well as instance information is added.
    """
    # Add basic template information
    child_list = add_template_classes( child_list )
    # Get children of every children. This is needed to tell the user,
    # what options (s)he still has to alter the tree.
    for node in child_list:
        sub_children = get_children( node.id, relation_map )
        for sub_child in sub_children:
            # Get template tree nodes
            template_tree_node = ClassInstanceAnnotationTreeTemplateNode.objects.filter(
                class_instance=sub_child.id)[0].annotation_tree_template_node
            # Add this instance to the node
            instance_list = node.child_nodes[template_tree_node.id]['class_instances']
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

    relation_map = get_relation_to_id_map(project_id)
    class_map = get_class_to_id_map(project_id)

    if 'root' not in class_map:
        raise CatmaidException('Can not find "root" class for this project')

    #for relation in ['model_of', 'part_of']:
    #    if relation not in relation_map:
    #        raise CatmaidException('Can not find "%s" relation for this project' % relation)

    # Get the template tree
    template_tree_set = ProjectAnnotationTreeTemplate.objects.filter(project=project_id)
    if template_tree_set == None:
        raise CatmaidException('Can not find a linked template tree')
    elif len(template_tree_set) > 1:
        raise CatmaidException('Found more than one linked template trees')
    else:
        template_tree = template_tree_set[0].annotation_tree_template

    # Find all the relations that are defined in it
    # ToDo: Maybe caching should be added
    relations = []

    response_on_error = ''
    try:
        if 0 == parent_id:
            response_on_error = 'Could not select the id of the root node.'
            root_node_q = ClassInstance.objects.filter(
                project=project_id,
                class_column=class_map['root'])

            if 0 == root_node_q.count():
                root_id = 0
                root_name = 'noname'
            else:
                root_node = root_node_q[0]
                root_id = root_node.id
                root_name = root_node.name

            # Collect all child node class instances
            child = Child( root_id, root_name, "root", 'root')
            add_template_fields( [child], relation_map )

            return HttpResponse(json.dumps([{
                'data': {'title': child.title},
                'attr': {'id': 'node_%s' % child.id,
                         'rel': child.node_type,
                         'template_node_id': template_tree.rootnode.id,
                         'child_nodes': json.dumps(child.child_nodes)},
                'state': 'closed'}]))

        response_on_error = 'Could not retrieve child nodes.'

        child_nodes = get_children( parent_id, relation_map )
        add_template_fields( child_nodes, relation_map )

        # TODO: When encountering a leaf node, "state" has to be omitted

        return HttpResponse(json.dumps(
                    tuple({'data': {'title': child.title },
                           'attr': {'id': 'node_%s' % child.id,
                                    'rel': child.node_type,
                                    'template_node_id': child.template_node_id,
                                    'template_node_name': child.template_node_name,
                                    'template_node_alt': json.dumps(child.template_node_alt),
                                    'child_nodes': json.dumps(child.child_nodes)},
                           'state': 'open'} for child in child_nodes)))

    except Exception as e:
        raise CatmaidException(response_on_error + ':' + str(e))

@requires_user_role(UserRole.Annotate)
@transaction_reportable_commit_on_success
def classification_instance_operation(request, project_id=None):
    params = {}
    int_keys = ('id', 'src', 'ref', 'parentid', 'relationnr', 'template_node_id')
    str_keys = ('title', 'operation', 'title', 'rel', 'classname', 'relationname', 'objname', 'targetname', 'newtype')
    for k in int_keys:
        params[k] = int(request.POST.get(k, 0))
    for k in str_keys:
        # TODO sanitize
        params[k] = request.POST.get(k, 0)
 
    relation_map = get_relation_to_id_map(project_id)
    class_map = get_class_to_id_map(project_id)

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
        template_tree_node = ClassInstanceAnnotationTreeTemplateNode.objects.filter(
            class_instance=node.id)[0].annotation_tree_template_node
        # Is it actually present in the template tree?
        if new_type not in template_tree_node.class_names:
            raise CatmaidException('The new type "%s" is no valid class name.' % new_type)
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
                # Delete link to template node
                ClassInstanceAnnotationTreeTemplateNode.objects.filter(class_instance=node.id)[0].delete()
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

        classification_instance_operation.res_on_err = 'Failed to insert link.'
        # Link the node to a template tree node
        ci_t_link = ClassInstanceAnnotationTreeTemplateNode()
        ci_t_link.class_instance_id = node.id
        ci_t_link.annotation_tree_template_node_id = int(params['template_node_id'])
        ci_t_link.save()

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
