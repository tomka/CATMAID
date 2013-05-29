import json

from django import forms
from django.conf import settings
from django.http import HttpResponse
from django.views.generic import TemplateView
from django.shortcuts import get_object_or_404, render_to_response
from django.template import RequestContext

from catmaid.control.common import get_class_to_id_map, get_relation_to_id_map
from catmaid.control.common import insert_into_log
from catmaid.control.ajax_templates import *
from catmaid.control.ontology import get_class_links_qs
from catmaid.models import Class, ClassClass, ClassInstance, ClassInstanceClassInstance
from catmaid.models import Relation, UserRole, Project, Restriction, Stack
from catmaid.models import CardinalityRestriction, RegionOfInterest
from catmaid.models import RegionOfInterestClassInstance
from catmaid.control.authentication import requires_user_role
from catmaid.control.roi import link_roi_to_class_instance

# All needed classes by the classification system alongside their
# descriptions.
needed_classes = {
    'classification_root':
         "The root node class for classification graphs",
    'classification_project':
         "A project represention to link to classification graphs"}

# All needed relations by the classification system alongside their
# descriptions.
needed_relations = {
    'is_a': "A basic is_a relation",
    'classified_by': "Link a classification to something",
    'linked_to': "Links a ROI to a class instance."}

class ClassProxy(Class):
    """ A proxy class to allow custom labeling of class in model forms.
    """
    class Meta:
        proxy=True

    def __unicode__(self):
        return "{0} ({1})".format(self.class_name, str(self.id))

class ClassInstanceClassInstanceProxy(ClassInstanceClassInstance):
    """ A proxy class to allow custom labeling of links between class
    instance objects in model forms.
    """
    class Meta:
        proxy=True

    def __unicode__(self):
        # Basic result string
        if len(self.class_instance_b.name) > 0:
            name = self.class_instance_b.name
        else:
            name = self.class_instance_b.class_column.class_name
        result = "{0} ({1})".format(name, str(self.id))

        # Display referce count if wanted
        display_refs = True
        if display_refs:
            # Get projects that are linked to this CI (expect it to be
            # a classification root)
            num_links = ClassInstanceClassInstance.objects.filter(
                class_instance_b=self.class_instance_b,
                relation__relation_name='classified_by').count()
            result = "{0} Refs: {1}".format(result, str(num_links))

        return result

def get_root_classes_count(workspace_pid):
    """ Return the number of available root classes for the given workspace
    project.
    """
    return get_class_links_qs(workspace_pid, 'is_a', 'classification_root').count()

def get_root_classes_qs(workspace_pid):
    """ Return a queryset that will get all root classes for the
    given workspace project.
    """
    return[ c.class_a.id for c in get_class_links_qs(workspace_pid, 'is_a', 'classification_root') ]

def get_classification_links_qs( workspace_pid, project_id, inverse=False ):
    """ Returns a list of CICI links that link a classification graph
    with a project. The classification system uses a dummy project with
    ID -1 to store its ontologies and class instances. Each project using
    a particular classification graph instance creates a class instance
    with its PID of class classification_project (which lives in dummy
    project -1) and links to a classification root. A query set for those
    links will be returned. If <inverse> is set to true, only those
    classification graph links will be returned that *don't* belong to
    the project with <project_id>.
    """
    # Expect the classification system to be set up and expect one
    # single 'classification_project' class.
    classification_project_c_q = Class.objects.filter(
        project_id = workspace_pid, class_name = 'classification_project')
    # Return an empty list if there isn't a classification project class
    if classification_project_c_q.count() == 0:
        return []
    classification_project_c = classification_project_c_q[0]

    # Get the query set for the classification project instance to test
    # if there already is such an instance.
    if inverse:
        classification_project_ci_q = ClassInstance.objects.filter(
            class_column_id = classification_project_c.id).exclude(
                project_id = project_id)
    else:
        classification_project_ci_q = ClassInstance.objects.filter(
            project_id = project_id, class_column_id = classification_project_c.id)
    # Return an empty list if there isn't a classification project
    # instance
    if classification_project_ci_q.count() == 0:
        return []
    classification_project_ci = classification_project_ci_q[0]

    # Get a list of all classification root classes and return an empty
    # list if teher are none
    root_class_links = get_class_links_qs(workspace_pid, 'is_a', 'classification_root')
    root_classes = [cc.class_a for cc in root_class_links]
    if not root_classes:
        return []
    # Query to get all root class instances
    root_class_instances = ClassInstance.objects.filter(project_id=workspace_pid,
        class_column__in=root_classes)
    # Query to get the 'classified_by' relation
    classified_by_rel = Relation.objects.filter(project_id=workspace_pid,
        relation_name='classified_by')
    # Find all 'classification_project' class instances of the current
    # project that link to those root nodes
    cici_q = ClassInstanceClassInstance.objects.filter(project_id=workspace_pid,
        relation__in=classified_by_rel, class_instance_b__in=root_class_instances,
        class_instance_a__in=classification_project_ci_q)

    return cici_q

def get_classification_roots( workspace_pid, project_id ):
    """ Returns a list of classification graph roots, linked to a
    project. The classification system uses a dummy project with ID -1
    to store its ontologies and class instances. Each project using a
    particular classification graph instance creates a class instance
    with its PID of class classification_project (which lives in dummy
    project -1). Those class instances will be returned.
    """
    # Get all links
    links_q = get_classification_links_qs( workspace_pid, project_id )
    # Return valid roots
    return [ cici.class_instance_a for cici in links_q ]

def get_classification_number( project_id ):
    """ Returns the number of classification graphs, linked to a
    project.
    """
    roots = get_classification_roots(project_id)
    return len(roots)

class Child:
    """ Keeps information about a potential child node.
    """
    def __init__(self, klass, rel, disabled):
        self.klass = klass
        self.rel = rel
        self.disabled = disabled

def get_child_links( parent_ci ):
    """ Returns all links to children of a node with id <parent_id>. The
    result is limited to a maximum ef <max_nodes> nodes.
    """
    # Get al a query set for all children that are linked to a parent
    # that is not linked by a relation named 'classified_by'.
    cici_q = ClassInstanceClassInstance.objects.filter(
        class_instance_b=parent_ci).exclude(
            relation__relation_name='classified_by')
    children = [cici for cici in cici_q]

    # Collect all child node class instances
    #children = []
    #for c in cici_q:
    #    child = Child(r, row[1], row[3])
    #    children.append( child )

    return children

def get_possibble_children( parent_ci ):
    """ Returns a dictionary of all possible children.
    """
    # Find possible alternative types. These are classes that have
    # the same parent as <parent_ci>.
    return []

def link_to_classification( project_id, cls_graph ):
    """ Links a project to a classification graph by creating a
    new class_instance_class_instance link for the project's
    classification_project class instance. It relates it to a
    class instance of a class that has a 'is_a' relation to a
    'classification_root' class, i.e. a classification graph root.
    Both are connected like this: 'classification_project'
    'classified_by' 'classification_root'. If  a project's
    classification_project class instance isn't available yet, it
    will be created.
    """
    # Get classification_project class instance for a project
    pass

def create_new_classification( workspace_pid, project_id ):
    """ creates a new classification graph instance. This basically
    means a new class instance is created that is based on a class
    whilh has a 'is_a' relation to the class 'classification_root'.
    Such a new class instance will live in the dummy project -1.
    """
    # Get the classification project class
    class_map = get_class_to_id_map(workspace_pid)
    if 'classification_project' not in class_map:
        raise Exception("Couldn't find 'classification_project' class")

    # Create new classification
    cls_graph = None
    # Link new classification to project
    link_to_classification( project_id, cls_graph )

def add_class(workspace_pid, class_user, class_name, class_desc):
    new_class = Class.objects.create(
        user = class_user,
        project_id = workspace_pid,
        class_name = class_name,
        description = class_desc)
    return new_class

def add_relation(workspace_pid, rel_user, rel_name, rel_desc, is_reciprocal=False):
    new_rel = Relation.objects.create(
        user = rel_user,
        project_id = workspace_pid,
        relation_name = rel_name,
        description = rel_desc,
        isreciprocal = is_reciprocal)
    return new_rel

def check_classification_setup_view(request, project_id=None):
    all_good = check_classification_setup()
    return HttpResponse(json.dumps({'all_good': all_good}))

def check_classification_setup(workspace_pid):
    """ Checks if all classes and relations needed by the
    classification system are available. Needed classes are
    'classification_root' and 'classification_project' and the
    nedded relations are 'is_a' and 'classified_by'.
    """
    # Get classification and relation data
    class_map = get_class_to_id_map(workspace_pid)
    relation_map = get_relation_to_id_map(workspace_pid)

    # Check if all is good
    all_good = True
    for c in needed_classes:
        all_good = (all_good and (c in class_map))
    for r in needed_relations:
        all_good = (all_good and (r in relation_map))

    return all_good

def rebuild_classification_setup_view(request, workspace_pid=None, project_id=None):
    setup_classification(workspace_pid, request.user)
    all_good = check_classification_setup(workspace_pid)
    return HttpResponse(json.dumps({'all_good': all_good}))

def setup_classification(workspace_pid, user):
    """ Tests which of the needed classes and relations is missing
    from the dummy project''s semantic space and adds those.
    """
    # Get classification and relation data
    class_map = get_class_to_id_map(workspace_pid)
    relation_map = get_relation_to_id_map(workspace_pid)

    # Add what is missing
    for c in needed_classes:
        if c not in class_map:
            add_class(workspace_pid, user, c, needed_classes[c])
    for r in needed_relations:
        if r not in relation_map:
            add_relation(workspace_pid, user, r, needed_relations[r])

class ClassificationGraphDisplay():
    """ This view displays the classification graph.
    """
    pass

class SelectionView():
    """ Provides a list of all classification graph instances linked
    to a certain project. The user can select one to trigger the
    display of it.
    """
    pass

class NewGraphView(TemplateView):
    """ Allows to create new classification graphs and link them to
    the current project.
    """
    template_name = 'catmaid/classification/new_graph.html'

    #ontologies =

def create_new_graph_form( workspace_pid, class_ids=None ):
    """ Creates a new NewGraphForm python class withan up-to-date
    class queryset.
    """
    if not class_ids:
        class_ids = get_root_classes_qs(workspace_pid)

    class NewGraphForm(forms.Form):
        """ A simple form to select classification ontologies. A choice
        field allows to select a single class that 'is_a' 'classification_root'.
        """
        ontology = forms.ModelChoiceField(
            queryset=ClassProxy.objects.filter(id__in=class_ids))

    return NewGraphForm

def create_linked_graphs_form( workspace_pid, project_id, inverse=True  ):
    """ Create a new AvailableClassificationsForm to display a set
    of classification graph root nodes. If <inverse> is True, then
    only the graphs *not* linked to tho project will be shown. If
    it is False, then only linked projects will be shown.
    """
    root_links = get_classification_links_qs( workspace_pid, project_id, inverse )
    # Make sure we use no classification graph more than once
    known_roots = []
    root_ids = []
    for link in root_links:
        if link.class_instance_b.id not in known_roots:
            known_roots.append(link.class_instance_b.id)
            root_ids.append(link.id)

    class AvailableClassificationsForm(forms.Form):
        """ A simple form to select an available classification for a
        project, excluding the ones already linked.
        """
        classification_graph = forms.ModelChoiceField(
            queryset = ClassInstanceClassInstanceProxy.objects.filter(id__in=root_ids))

    return AvailableClassificationsForm

def show_classification_editor( request, workspace_pid=None, project_id=None, link_id=None):
    """ Selects the right view to show, based on the provided project.
    """
    project_id = int(project_id)
    workspace_pid = int(workspace_pid)
    project = Project.objects.get(id=project_id)
    workspace = Project.objects.get(id=workspace_pid)
    context = RequestContext(request, {
        'project': project,
        'workspace': workspace,
    })
    # First, check if the classification system is correctly set-up
    setup_okay = check_classification_setup(workspace_pid)
    if not setup_okay:
        template_name = "catmaid/classification/setup.html"
        page_type = 'setup'
        link_if = -1
    else:
        if link_id is not None:
            num_graphs = 1

            selected_graph_q = ClassInstanceClassInstance.objects.filter(
                id=link_id, project=workspace_pid)
            # Make sure we actually got a graph:
            if selected_graph_q.count() != 1:
                raise Exception("Couldn't select requested classification graph with ID %d." % link_id)
            else:
                selected_graph = selected_graph_q[0]

            context['num_graphs'] = 1
            context['graph_id'] = link_id
            context['settings'] = settings

            template_name = "catmaid/classification/show_graph.html"
            page_type = 'show_graph'
        else:
            # Second, check how many graphs there are.
            root_links_q = get_classification_links_qs( workspace_pid, project_id )
            num_roots = len(root_links_q)

            context['num_graphs'] = num_roots
            context['CATMAID_URL'] = settings.CATMAID_URL

            if num_roots == 0:
                new_graph_form_class = create_new_graph_form(workspace_pid)
                context['new_graph_form'] = new_graph_form_class()
                link_form = create_linked_graphs_form(workspace_pid, project_id)
                context['link_graph_form'] = link_form()
                num_root_classes = get_root_classes_count(workspace_pid)
                context['num_root_classes'] = num_root_classes
                template_name = "catmaid/classification/new_graph.html"
                page_type = 'new_graph'
                link_id = -1
            elif num_roots == 1:
                selected_graph = root_links_q[0]
                context['graph_id'] = selected_graph.id
                template_name = "catmaid/classification/show_graph.html"
                page_type = 'show_graph'
                link_id = selected_graph.id
            else:
                form = create_linked_graphs_form(workspace_pid, project_id, False)
                context['select_graph_form'] = form()
                template_name = "catmaid/classification/select_graph.html"
                page_type = 'select_graph'
                link_id = -1

    rendered_block = render_block_to_string( template_name,
        'classification-content', {}, context )
    return HttpResponse(json.dumps({
        'content': rendered_block,
        'page': page_type,
        'link': link_id}))

@requires_user_role([UserRole.Annotate, UserRole.Browse])
def add_classification_graph(request, workspace_pid=None, project_id=None):
    workspace_pid = int(workspace_pid)
    project_id = int(project_id)
    project = get_object_or_404(Project, pk=project_id)
    # Has the form been submitted?
    new_graph_form_class = create_new_graph_form(workspace_pid)
    if request.method == 'POST':
        new_graph_form = new_graph_form_class(request.POST)
        if new_graph_form.is_valid():
            # Create the new classification graph
            ontology = new_graph_form.cleaned_data['ontology']
            ontology_root_ci = init_new_classification( workspace_pid,
                request.user, ontology )
            # Link this graph instance to the project
            link_existing_classification( workspace_pid, request.user,
                project, ontology_root_ci )
            return HttpResponse('A new graph has been initalized.')
    else:
        new_graph_form = new_graph_form_class()

    workspace = get_object_or_404(Project, pk=workspace_pid)
    link_form = create_linked_graphs_form( workspace.id, project.id )
    link_graph_form = link_form()
    num_root_classes = get_root_classes_count(workspace_pid)

    return render_to_response("catmaid/classification/new_graph.html", {
        'project': project,
        'workspace': workspace,
        'new_graph_form': new_graph_form,
        'link_graph_form': link_graph_form,
        'num_root_classes': num_root_classes,
        'CATMAID_URL': settings.CATMAID_URL
    }, context_instance=RequestContext(request))

@requires_user_role([UserRole.Annotate, UserRole.Browse])
def link_classification_graph(request, workspace_pid=None, project_id=None):
    workspace_pid = int(workspace_pid)
    project_id = int(project_id)
    project = get_object_or_404(Project, pk=project_id)
    link_form = create_linked_graphs_form( workspace_pid, project_id )
    # Has the form been submitted?
    if request.method == 'POST':
        link_graph_form = link_form(request.POST)
        if link_graph_form.is_valid():
            # Link existing classification graph
            link = link_graph_form.cleaned_data['classification_graph']
            graph_to_link = link.class_instance_b
            link_existing_classification( workspace_pid, request.user, project, graph_to_link)
            return HttpResponse('An existing graph has been linked.')
    else:
        link_graph_form = link_form()

    workspace = get_object_or_404(Project, pk=workspace_pid)

    new_graph_form_class = create_new_graph_form(workspace_pid)
    new_graph_form = new_graph_form_class()
    num_root_classes = get_root_classes_count(workspace_pid)

    return render_to_response("catmaid/classification/new_graph.html", {
        'project': project,
        'workspace': workspace,
        'new_graph_form': new_graph_form,
        'link_graph_form': link_graph_form,
        'num_root_classes': num_root_classes,
        'CATMAID_URL': settings.CATMAID_URL
    }, context_instance=RequestContext(request))

@requires_user_role([UserRole.Annotate, UserRole.Browse])
def select_classification_graph(request, workspace_pid=None, project_id=None):
    workspace_pid = int(workspace_pid)
    project_id = int(project_id)
    link_form = create_linked_graphs_form( workspace_pid, project_id, False )
    # Has the form been submitted?
    if request.method == 'POST':
        form = link_form(request.POST)
        if form.is_valid():
            # Link existing classification graph
            link = form.cleaned_data['classification_graph']
            return show_classification_editor(request, workspace_pid, project_id, link.id)
    else:
        project = get_object_or_404(Project, pk=project_id)
        workspace = get_object_or_404(Project, pk=workspace_pid)
        root_links_q = get_classification_links_qs( workspace_pid, project_id )
        num_roots = len(root_links_q)
        form = link_form()

        return render_to_response("catmaid/classification/select_graph.html", {
            'project': project,
            'workspace': workspace,
            'select_graph_form': new_graph_form,
            'num_graphs': num_roots,
        }, context_instance=RequestContext(request))

@requires_user_role([UserRole.Annotate, UserRole.Browse])
def remove_classification_graph(request, workspace_pid, project_id=None, link_id=None):
    """ Removes the link between a project and a classification graph. If
    no other project links to the graph anymore, the graph is removed as
    well.
    """
    project_id = int(project_id)
    workspace_pid = int(workspace_pid)
    selected_graph = ClassInstanceClassInstance.objects.filter(
        id=link_id, project=workspace_pid)
    # Make sure we actually got a graph:
    if selected_graph.count() != 1:
        raise Exception("Couldn't select requested graph with ID %s." % link_id)
    else:
        selected_graph = selected_graph[0]

    # Do some sanity checks
    project_ci = selected_graph.class_instance_a
    graph_ci = selected_graph.class_instance_b
    links_project = (project_ci.project_id == project_id)
    if not links_project:
        raise Exception("The link to remove doesn't link to the current project.")
    has_correct_prj_class = (project_ci.class_column.class_name == "classification_project")
    if not has_correct_prj_class:
        raise Exception("The link provided doesn't refer to a 'classification_project' instance.")
    has_correct_relation = (selected_graph.relation.relation_name == 'classified_by')
    if not has_correct_relation:
        raise Exception("The link to remove doesn't use a 'classified_by' relation and therefore isn't recognized as a proper classification graph.")
    root_links_q = ClassClass.objects.filter(class_a=graph_ci.class_column,
        relation__relation_name='is_a', class_b__class_name='classification_root')
    if root_links_q.count() == 0:
        raise Exception("The link provided doesn't refer to a 'classification_root' derived instance.")

    # Collect some statistics
    num_removed_links = 0
    num_removed_ci = 0
    num_total_refs = 0

    # Delete the link
    selected_graph.delete()
    num_removed_links = num_removed_links + 1
    # Find number of other projects that are linked to the
    # classification graph that should get deleted
    num_extra_links = ClassInstanceClassInstance.objects.filter(
        project=workspace_pid, class_instance_b=selected_graph.class_instance_b).count()
    num_total_refs = num_total_refs + num_extra_links
    # If there are no other links to a classification graph, its class
    # instances get removed
    if num_extra_links == 0:
        def delete_node(node):
            # TODO: Delete only if a node is not linked to another class
            # instance that lives outside of the graph.
            node.delete()
        # Walk over all class instances
        traverse_class_instances(selected_graph.class_instance_b, delete_node)
        num_removed_ci = num_removed_ci + 1

    #get_classification_links_qs

    if num_removed_links == 0:
        msg = 'The requested link couldn\'t get removed.'
    elif num_removed_ci == 0:
        msg = 'All links from this project to the classifiation graph have been removed. There are still ' + str(num_total_refs) + ' link(s) to this classification graph present.'
    else:
        msg = 'The classification graph has been removed, along with its ' + str(num_removed_ci) + ' class instances.'

    return HttpResponse(msg)

def traverse_class_instances(node, func):
    """ Traverses a class instance graph, starting from the passed node.
    It recurses into child trees and calls the passed function on each
    node."""
    children = ClassInstance.objects.filter(cici_via_a__class_instance_b=node)
    for c in children:
        traverse_class_instances(c, func)
    func(node)


def init_new_classification( workspace_pid, user, ontology ):
    """ Intializes a new classification graph which is automatically
    linked to the provided project. This graph is based on the passed
    ontology (a root class in the semantic space).
    """
    # Create a new ontology root instance
    ontology_root_ci = ClassInstance.objects.create(user = user,
        project_id = workspace_pid, class_column = ontology)
    return ontology_root_ci

def link_existing_classification( workspace_pid, user, project, ontology_root_ci ):
    """ Links a project to an existing graph (class instance) and places
    it in classification space. The project's 'classification_project'
    class instance is fetched (or created if not present) and linked to
    the root class instance. The relation used for this is 'classified_by'.
    """
    # Try to fetch the project's 'classification_project' class instance
    cp_c_q = Class.objects.filter(
        project_id = workspace_pid, class_name = 'classification_project')
    if cp_c_q.count() == 0:
        raise Exception("Could not find class 'classification_project'. " \
            "The classification system appears to be not set up correctly " \
            "for workspace/project %d." % workspace_pid)
    cp_ci_q = ClassInstance.objects.filter(
        project = project, class_column__in=cp_c_q)
    # Get the 'classified_by' relation
    clsby_rel_q = Relation.objects.filter(
        project_id = workspace_pid, relation_name = 'classified_by')
    if clsby_rel_q.count() == 0:
        raise Exception("Could not find relation 'classified_by'. \
            The classification system appears to be not set up correctly.")

    # Create a new 'classification_project' instance for the current project
    # or use an already presont one (if any).
    if cp_ci_q.count() == 0:
        cp_ci = ClassInstance.objects.create(
            user = user,
            project = project,
            class_column = cp_c_q[0])
    else:
        cp_ci = cp_ci_q[0]

    # Link both, the ontology root CI and the classification project CI
    link = ClassInstanceClassInstance.objects.create(
        user = user,
        project_id = workspace_pid,
        relation = clsby_rel_q[0],
        class_instance_a = cp_ci,
        class_instance_b = ontology_root_ci)

def collect_reachable_classes( parent_class):
    """ Find all classes that are directly linked to <parent_class>
    and that are linked to a super class to which <parent class> is
    linked with a 'is_a' relation (if available). Collect the link
    of such a class if it doesn't use an 'is_a' relation.
    """
    available_links = []
    # Get all links to classes directly linked to the parent class
    cc_q = ClassClass.objects.filter(class_b=parent_class)
    # Add every link that does't use an 'is_a' relation
    for cc in cc_q:
        if cc.relation.relation_name != 'is_a':
            available_links.append(cc)
    # Get all links from super-classes
    super_cc_q = ClassClass.objects.filter(class_a=parent_class,
        relation__relation_name='is_a')
    # Collect all reachable classes of each super class
    for cc in super_cc_q:
        super_links = collect_reachable_classes( cc.class_b )
        available_links = available_links + super_links

    return available_links

def get_child_classes( workspace_pid, parent_ci ):
    """ Gets all possible child classes out of the linked ontology in
    the semantic space. If the addition of a child-class woult violate
    a restriction, it isn't used.
    """
    parent_class = parent_ci.class_column
    # Get all possible child classes
    available_links = collect_reachable_classes( parent_class )
    # Create a dictionary where all classes are assigned to a class which
    # is used as a generalization (if possible). The generalization of a
    # class is linked to it with an 'is_a' relation.
    child_types = {}
    def add_class( key, links, c, rel ):
        restrictions = []
        # Iterate all links that might be relevant for this element
        for link in links:
            # Get all restrictions for the current link
            restrictions_q = Restriction.objects.filter(restricted_link=link)
            restrictions = restrictions + [ r for r in restrictions_q]

        if len(restrictions) == 0:
            disabled = False
        else:
            # If there are restrictions, test if they would be violated
            # by adding the current class
            disabled = False
            for r in restrictions:
                # Find out type of the restriction
                cr_q = CardinalityRestriction.objects.filter(id=r.id)
                if cr_q.count() > 0:
                    # It is a cardinality restriction
                    disabled = cr_q[0].would_violate( parent_ci, c )
                else:
                    # Unknown restriction
                    raise Exception("Couldn't identify the restriction with ID %d." % (r.id))

        # Create child class data structure
        current_child = Child(c, rel, disabled)
        if key not in child_types:
            child_types[key] = []
        child_types[key].append(current_child)

    for cc in available_links:
        c = cc.class_a
        r = cc.relation
        # Test if the current child class has sub-types
        sub_class_links = get_class_links_qs( workspace_pid, 'is_a', c )
        if sub_class_links.count() == 0:
            # Add class to generic 'Element' group
            add_class( 'Elememt', [cc], c, r )
        else:
            # On entry for each 'is_a' link (usually one)
            for scc in sub_class_links:
                add_class( c.class_name, [cc, scc], scc.class_a, r )

    return child_types

def child_types_to_jstree_dict(child_types):
    """ Converts a child type directory as created by the
    get_child_classes function to a dictionany that can be
    converted into JSON and consumed by jsTree.
    """
    json_dict = {}
    for ct in child_types:
        children = child_types[ct]
        for c in children:
            # Create class data structure
            cdata = { 'id': c.klass.id, 'name': c.klass.class_name,
                'disabled': c.disabled, 'relname': c.rel.relation_name,
                'relid': c.rel.id }
            if ct not in json_dict:
                json_dict[ct] = []
            json_dict[ct].append(cdata)
    return json_dict

@requires_user_role([UserRole.Annotate, UserRole.Browse])
def list_classification_graph(request, workspace_pid, project_id=None, link_id=None):
    """ Produces a data structure for each node of a classification graph
    that is undetstood by jsTree.
    """
    project_id = int(project_id)
    workspace_pid = int(workspace_pid)
    link_id = None if link_id is None else int(link_id)
    parent_id = int(request.GET.get('parentid', 0))
    parent_name = request.GET.get('parentname', '')
    expand_request = request.GET.get('expandtarget', None)
    superclass_in_name = bool(int(request.GET.get('superclassnames', 0)))
    display_edit_tools = bool(int(request.GET.get('edittools', 0)))

    if expand_request is None:
        expand_request = tuple()
    else:
        # Parse to int to sanitize
        expand_request = tuple(int(x) for x in expand_request.split(','))

    max_nodes = 5000  # Limit number of nodes retrievable.

    if link_id is None:
        # Get all links
        links_q = get_classification_links_qs( workspace_pid, project_id )
        # Return valid roots
        root_links = [ cici for cici in links_q ]
        num_roots = len(root_links)

        # Get classification instance
        if num_roots == 0:
            raise Exception("No classification graph was found for this project.")
        if num_roots > 1:
            raise Exception("There is more than one classification graph and none was selected.")
        else:
            # Select the only root available for this project
            root_link = root_links[0]
    else:
        # The link passed is a CICI link which links a project to a
        # certain classification root.
        cici_q = ClassInstanceClassInstance.objects.filter(id=link_id,
            relation__relation_name='classified_by')
        if cici_q.count() == 0:
            raise Exception("The specified link was not found.")
        root_link = cici_q[0]
        cls_prj = root_link.class_instance_a
        if cls_prj.project_id != project_id:
            raise Exception("The link was found, but belongs to another project.")

    response_on_error = ''
    try:
        def get_class_name( klass ):
            if superclass_in_name:
                super_class_links_q = get_class_links_qs( workspace_pid,
                    'is_a', klass, False )
                if super_class_links_q.count() > 0:
                    cname = super_class_links_q[0].class_b.class_name
                    return "%s: %s" % (cname, klass.class_name)
                else:
                    return klass.class_name
            else:
                return klass.class_name

        if 0 == parent_id:
            cls_graph = root_link.class_instance_b
            response_on_error = 'Could not select the id of the classification root node.'

            # Collect all child node class instances
            #child = Child( root_id, root_name, "classification_root", 'root')
            #add_template_fields( [child] )
            response_on_error = 'Could not select child classes.'
            child_types = get_child_classes( workspace_pid, cls_graph )
            child_types_jstree = child_types_to_jstree_dict( child_types )

            # Create JSTree data structure
            if len(cls_graph.name) > 0:
                root_name = cls_graph.name
            else:
                root_name = cls_graph.class_column.class_name
            data = {'data': {'title': root_name},
                'attr': {'id': 'node_%s' % cls_graph.id,
                         'linkid': root_link.id,
                         'rel': 'root',
                         'child_groups': json.dumps(child_types_jstree)}}
            # Test if there are children links present and mark
            # node as leaf if there are none.
            child_links = get_child_links( cls_graph )
            if len(child_links) > 0:
                data['state'] = 'closed'

            return HttpResponse(json.dumps([data]))
        else:
            # Edit tools should only be displayed if wanted by the user and
            # if the user has the can_annotate permission
            if display_edit_tools:
                project = Project.objects.get(id=project_id)
                display_edit_tools = request.user.has_perm('can_annotate', project)

            # Get parent class instance
            parent_q = ClassInstance.objects.filter(id=parent_id)
            if parent_q.count() == 0:
                raise Exception("Couldn't select parent class instance with ID %s." % parent_id)
            parent_ci = parent_q[0]
            # Get all to root linked class instances
            child_links = get_child_links( parent_ci )

            response_on_error = 'Could not retrieve child nodes.'
            #add_template_fields( child_nodes )

            # Get child types
            child_types = get_child_classes( workspace_pid, parent_ci )

            def make_roi_html(roi):
                img_data = (roi.id, settings.STATIC_URL)
                return "<img class='roiimage' roi_id='%s' " \
                       "src='%s/widgets/themes/kde/camera.png' \>" % img_data

            child_data = []
            for child_link in child_links:
                child = child_link.class_instance_a
                # Find ROIs for this class instance
                roi_links = RegionOfInterestClassInstance.objects.filter(
                    class_instance=child)
                roi_htmls = []
                for roi_link in roi_links:
                    roi_htmls.append( make_roi_html(roi_link.region_of_interest) )
                roi_html = ''.join(roi_htmls)
                roi_json = json.dumps( [r.id for r in roi_links] )
                # Get sub-child information
                subchild_types = get_child_classes( workspace_pid, child )
                subchild_types_jstree = child_types_to_jstree_dict( subchild_types )
                # Build title
                if roi_html:
                    title = "%s %s" % (get_class_name(child.class_column), roi_html)
                else:
                    title = get_class_name(child.class_column)
                # Build JSTree data structure
                data = {'data': {'title': title},
                    'attr': {'id': 'node_%s' % child.id,
                             'linkid': child_link.id,
                             'rel': 'element',
                             'rois': roi_json,
                             'child_groups': json.dumps(subchild_types_jstree)}}

                # Test if there are children links present and mark
                # node as leaf if there are none. Also, mark not as
                # leaf if in edit mode and new nodes can be added.
                sub_child_links = get_child_links( child )
                if len(sub_child_links) > 0:
                    data['state'] = 'closed'
                elif display_edit_tools and len(subchild_types) > 0:
                    data['state'] = 'closed'

                child_data.append(data)

            if display_edit_tools:
                response_on_error = 'Could not create child node menu.'
                for child_type in child_types:
                    options = []
                    children = child_types[child_type]
                    for child in children:
                        # Only add items that are not disabled, because
                        # only those items can actually be added.
                        if not child.disabled:
                            options.append( (child.klass.id, get_class_name(child.klass), child.rel.id) )
                    # Add drop down list if there are options
                    if len(options) > 0:
                        menu_class = 'select_new_classification_instance'
                        select_menu = '<div name="add_instance" class="%s" parentid="%d">' \
                            % (menu_class, parent_ci.id)

                        for k,v,rel in options:
                            select_menu = '%s<div value="%s" relid="%d"><a href="#">%s</a></div>' \
                                % (select_menu, k, rel, v)
                        select_menu = select_menu + '</div>'

                        select_input = '<span>(Add %s)\n%s</span>' % (child_type, select_menu)
                        data = {'data': {'title': select_input,
                                         'attr': {'class': 'editnode'}},
                                'attr': {'class': 'editnode',
                                         'rel': 'editnode'}}
                        child_data.append(data)


            return HttpResponse(json.dumps(tuple(cd for cd in child_data)))
    except Exception as e:
        raise Exception(response_on_error + ':' + str(e))

@requires_user_role(UserRole.Annotate)
def classification_instance_operation(request, workspace_pid=None, project_id=None):
    workspace_pid = int(workspace_pid)
    params = {}
    int_keys = ('id', 'parentid', 'relationid', 'classid', 'linkid')
    str_keys = ('operation', 'title', 'rel', 'objname')
    for k in int_keys:
        params[k] = int(request.POST.get(k, 0))
    for k in str_keys:
        # TODO sanitize
        params[k] = request.POST.get(k, 0)

    relation_map = get_relation_to_id_map(workspace_pid)
    class_map = get_class_to_id_map(workspace_pid)

    # We avoid many try/except clauses by setting this string to be the
    # response we return if an exception is thrown.
    classification_instance_operation.res_on_err = ''

    def create_node():
        """ Creates a new node.
        """
        # TODO: Test if class and parent class instance exist
        # if params['classid'] not in class_map:
        #    raise CatmaidException('Failed to select class.')

        classification_instance_operation.res_on_err = 'Failed to insert instance of class.'
        node = ClassInstance(
                user=request.user,
                name=params['objname'])
        node.project_id = workspace_pid
        node.class_column_id = params['classid']
        node.save()
        class_name = node.class_column.class_name
        insert_into_log(project_id, request.user.id, "create_%s" % class_name,
            None, "Created %s with ID %s" % (class_name, params['id']))

        # We need to connect the node to its parent, or to root if no valid parent is given.
        node_parent_id = params['parentid']
        # TODO: Test if tis parent exists

        #if 0 == params['parentid']:
        #    # Find root element
        #    classification_instance_operation.res_on_err = 'Failed to select classification root.'
        #    node_parent_id = ClassInstance.objects.filter(
        #            project=workspace_pid,
        #            class_column=class_map['classification_root'])[0].id

        #Relation.objects.filter(id=params['relationid'])
        #if params['relationname'] not in relation_map:
        #    raise CatmaidException('Failed to select relation %s' % params['relationname'])

        classification_instance_operation.res_on_err = 'Failed to insert CICI-link.'
        cici = ClassInstanceClassInstance()
        cici.user = request.user
        cici.project_id = workspace_pid
        cici.relation_id = params['relationid']
        cici.class_instance_a_id = node.id
        cici.class_instance_b_id = node_parent_id
        cici.save()

        return HttpResponse(json.dumps({'class_instance_id': node.id}))

    def remove_node():
        """ Will remove a node.
        """
        # A class instance can be linked to different other class instances. This
        # operation will remove a complete class instance and thus *all* links to
        # other class instances.
        if 0 == params['rel']:
            raise Exception('No node type given!')
        elif 'element' == params['rel']:
            # Delete a standard non-root element and its sub-tree.

            def delete_node( node ):
                # Find and delete children
                classification_instance_operation.res_on_err \
                    = 'Failed to delete relation from instance table.'
                cici = ClassInstanceClassInstance.objects.filter(class_instance_b=node.id)
                for rel in cici:
                    # Delete children
                    delete_node( rel.class_instance_a )

                # Delete class instance
                node.delete()

                # Log
                insert_into_log(project_id, request.user.id, 'remove_element', None,
                    'Removed classification with ID %s and name %s' % (params['id'],
                        params['title']))

            classification_instance_operation.res_on_err \
                = 'Failed to select node from instance table.'
            node_to_delete = ClassInstance.objects.filter(id=params['id'])
            if node_to_delete.count() == 0:
                raise Exception('Could not find any node with ID %s' % params['id'])
            else:
                delete_node( node_to_delete[0] )
                response = {'status': 1, 'message': 'Removed node %s successfully.' % params['id']}
                return HttpResponse(json.dumps(response))
        else:
            classification_instance_operation.res_on_err \
                = 'Failed to delete node from instance table.'
            node_to_delete = ClassInstance.objects.filter(id=params['id'])
            if node_to_delete.count() == 0:
                raise Exception('Could not find any node with ID %s' % params['id'])
            else:
                node_to_delete.delete()
                response = {'status': 1, 'message': 'Removed node %s successfully.' % params['id']}
                return HttpResponse(json.dumps(response))

    try:
        # Dispatch to operation
        if params['operation'] not in ['create_node', 'remove_node']:
            raise Exception('No operation called %s.' % params['operation'])
        return locals()[params['operation']]()
    except Exception as e:
        if classification_instance_operation.res_on_err == '':
            raise
        else:
            raise Exception(classification_instance_operation.res_on_err + '\n' + str(e))

def infer_new_instances( workspace_pid, link, parent_ci ):
    """ Based on a link within the semantic space and an instantiated
    class in the classification space, new possible class intances are
    inferred and returned as a tuple (class_to_add, relation, parent_ci)
    """
    instances_to_add = []
    # Get all restrictions linked to this link
    restrictions = Restriction.objects.filter(project_id=workspace_pid,
        restricted_link=link)
    # See what can be inferred from each restriction
    for r in restrictions:
        # Find out type of the restriction
        cr_q = CardinalityRestriction.objects.filter(id=r.id)
        if cr_q.count() > 0:
            # It is a cardinality restriction.
            cr = cr_q[0]
            # Simple case: one instance per sub-type
            if cr.cardinality_type == 3 and cr.value == 1:
                print("CR: %d" % cr.id)
                # Iterate all sub-types
                sub_class_links = get_class_links_qs(workspace_pid, 'is_a',
                    link.class_a)
                for sc in sub_class_links:
                    class_to_add = sc.class_a
                    if not cr.would_violate(parent_ci, class_to_add):
                        instances_to_add.append( (class_to_add, link.relation, parent_ci) )
        else:
            # Unknown restriction
            raise Exception("Couldn't identify the restriction with ID %d." % (r.id))

    return instances_to_add

def autofill( workspace_pid, user, parent_ci, excluded_links=[] ):
    """ Infers new class instances based on restrictions and creates
    them. This method returns a list of all added class instances.
    """
    added_nodes = []
    # Get class-class links starting on root node and that don't use
    # 'is_a' as relation. Also, avoid to use links twice by maintaining
    # a list of excluded links.
    direct_links = ClassClass.objects.filter(
        class_b=parent_ci.class_column).exclude(
            relation__relation_name='is_a', id__in=excluded_links)
    # Get super-types (if any) and links starting there
    supertypes_q = ClassClass.objects.filter(
        class_a=parent_ci.class_column, relation__relation_name='is_a')
    supertypes = [st.class_b for st in supertypes_q]
    supertype_links = ClassClass.objects.filter(
        class_b__in=supertypes).exclude(
            relation__relation_name='is_a', id__in=excluded_links)

    print("Parent: %d Class: %d" % (parent_ci.id, parent_ci.class_column.id))
    print("Excluded links: %s" % str(excluded_links))

    links = [l for l in direct_links] + [stl for stl in supertype_links]

    for l in links:
        print("Link: %d" % l.id)
        # Add to excluded links:
        excluded_links.append(l.id)
        # Get new instances and add them
        instances_to_add = infer_new_instances(workspace_pid, l, parent_ci)
        for node_class, node_rel, node_parent in instances_to_add:
            node = ClassInstance.objects.create(
                user=user,
                project_id=workspace_pid,
                class_column=node_class,
                name="")
            # Create a new link, using the base link relation,
            # because a sub-type is added here.
            cici = ClassInstanceClassInstance.objects.create(
                user = user,
                project_id = workspace_pid,
                relation = node_rel,
                class_instance_a_id = node.id,
                class_instance_b_id = node_parent.id)
            added_nodes.append(node)

    # Starting at every class-instance directly linked to the parent,
    # recursively walk links to other class instances. Collect new
    # nodes if there are new ones created.
    sub_instance_links_q = ClassInstanceClassInstance.objects.filter(
        class_instance_b=parent_ci, project_id=workspace_pid);
    all_added_nodes = added_nodes
    for sil in sub_instance_links_q:
        si = sil.class_instance_a
        print("Parent: %d Sub: %d" % (parent_ci.id, si.id))
        added_sub_nodes = autofill(workspace_pid, user, si, excluded_links)
        all_added_nodes = all_added_nodes + added_sub_nodes

    return all_added_nodes

@requires_user_role([UserRole.Annotate, UserRole.Browse])
def autofill_classification_graph(request, workspace_pid, project_id=None, link_id=None):
    """ This method tries to infer needed class instances according to
    the restrictions in use. If there are no restrictions, nothing can
    be inferred.
    """
    # Select the graph
    selected_graph = ClassInstanceClassInstance.objects.filter(
        id=link_id, project=workspace_pid)
    # Make sure we actually got a result
    if selected_graph.count() != 1:
        raise Exception("Couldn't select requested classification graph.")
    else:
        selected_graph = selected_graph[0]

    parent_ci = selected_graph.class_instance_b

    added_nodes = autofill(workspace_pid, request.user, parent_ci)

    node_names = [ n.class_column.class_name for n in added_nodes]
    if len(node_names) > 0:
        return HttpResponse("Added nodes: %s" % ','.join(node_names))
    else:
        return HttpResponse("Couldn't infer any new class instances.")

@requires_user_role([UserRole.Annotate, UserRole.Browse])
def link_roi_to_classification(request, project_id=None, workspace_pid=None,
        stack_id=None, ci_id=None):
    """ With the help of this method one can link a region of interest
    (ROI) to a class instance in a classification graph. The information
    about the ROI is passed as POST variables.
    """
    # Find 'linked_to' relatios
    rel = Relation.objects.get(project_id=workspace_pid,
        relation_name="linked_to")

    return link_roi_to_class_instance(request, project_id=project_id,
        relation_id=rel.id, stack_id=stack_id, ci_id=ci_id)
