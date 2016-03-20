import json
import re

from collections import defaultdict

from django.conf import settings
from django.db.models import Count
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.template import Context, loader
from django.contrib.contenttypes.models import ContentType

from taggit.models import TaggedItem

from catmaid.control.common import makeJSON_legacy_list
from catmaid.control.project import get_project_qs_for_user, extend_projects
from catmaid.models import DataView, DataViewType, Project, Stack, ProjectStack, StackGroup

def get_data_view_type_comment( request ):
    """ Return the comment of a specific data view type.
    """
    requested_id = request.REQUEST["data_view_type_id"]
    if requested_id == "":
        text = "Please select a valid data view type."
    else:
        try:
            data_view_type_id = int(requested_id)
            text = DataViewType.objects.get(pk=data_view_type_id).comment
        except:
            text = "Sorry, the configuration help text couldn't be retrieved."
    result = { 'comment':text }
    return HttpResponse(json.dumps(result), content_type="application/json")

def dataview_to_dict( dataview ):
    """ Creates a dicitonary of the dataviews' properties.
    """
    return {
        'id': dataview.id,
        'title': dataview.title,
        'code_type': dataview.data_view_type.code_type,
        'config': dataview.config,
        'note': dataview.comment
    }

def get_data_view_type( request, data_view_id ):
    """ Returns the type of a particular data view.
    """
    dv = get_object_or_404(DataView, pk=data_view_id)
    code_type = dv.data_view_type.code_type

    return HttpResponse(json.dumps({ 'type': code_type }))

def get_available_data_views( request ):
    """ Returns a list of all available data views.
    """
    all_views = DataView.objects.order_by("position")
    dataviews = map(dataview_to_dict, all_views)

    return HttpResponse(json.dumps(makeJSON_legacy_list(dataviews)), content_type="application/json")

def get_default_properties( request ):
    """ Return the properies of the default data view.
    """
    default = DataView.objects.filter(is_default=True)[0]
    default = dataview_to_dict( default )

    return HttpResponse(json.dumps(default), content_type="application/json")

def get_default_data_view( request ):
    """ Return the data view that is marked as the default. If there
    is more than one view marked as default, the first one is returned.
    """
    default = DataView.objects.filter(is_default=True)[0]

    return get_data_view( request, default.id )

def natural_sort(l, field):
    """ Natural sorting of a list wrt. to its 'title' attribute.
    Based on: http://stackoverflow.com/questions/4836710
    """
    convert = lambda text: int(text) if text.isdigit() else text.lower()
    alphanum_key = lambda key: [ convert(c) for c in re.split('([0-9]+)', getattr(key, field)) ]
    return sorted(l, key = alphanum_key)

def get_data_view( request, data_view_id ):
    """ Returns a rendered template for the given view.
    """
    # Load the template
    dv = get_object_or_404(DataView, pk=data_view_id)
    code_type = dv.data_view_type.code_type
    template = loader.get_template( "catmaid/" + code_type + ".html" )
    # Get project information and pass all to the template context
    config = json.loads( dv.config )

    # Get all the projects that are visible for the current user
    projects = get_project_qs_for_user(request.user)

    # If requested, filter projects by tags. Otherwise, get all.
    if "filter_tags" in config:
        filter_tags = config["filter_tags"]
        # Only get projects that have all the filter tags set
        # TODO: Improve performande by not using an IN query (but a temp table
        # join) over all filter_tags.
        projects = projects.filter( tags__name__in=filter_tags ).annotate(
            repeat_count=Count("id") ).filter( repeat_count=len(filter_tags) )

    show_stacks = config.get('show_stacks', True)
    show_stackgroups = config.get('show_stackgroups', True)

    # Make sure we get all needed stacks in the first query
    if show_stacks:
        projects = projects.prefetch_related('stacks')

    # Build a stack index
    stack_index = defaultdict(list)
    stacks_of = defaultdict(list)

    if show_stacks:
        for p in projects:
            for s in p.stacks.all():
                stack_index[s.id] = s
                stacks_of[p.id].append(s)

    # Build a stack group index, if stack groups should be made available
    stackgroup_index = defaultdict(list)
    stackgroups_of = defaultdict(list)
    if show_stackgroups:
        # Get all
        stackgroups = StackGroup.objects.filter(project__in=projects)
        for sg in stackgroups:
            stackgroup_index[sg.id] = sg
            stackgroups_of[sg.project_id].append(sg)

    # Extend the project list with additional information like editabilty
    projects = extend_projects( request.user, projects )

    # Sort by default
    if "sort" not in config or config["sort"] == True:
        projects = natural_sort( projects, "title" )

    # Build project index
    project_index = dict([(p.id, p) for p in projects])
    project_ids = set(project_index.keys())

    # Build tag index
    ct = ContentType.objects.get_for_model(Project)
    tag_links = TaggedItem.objects.filter(content_type=ct) \
        .values_list('object_id', 'tag__name')
    tag_index = defaultdict(set)
    for pid, t in tag_links:
        if pid in project_ids:
            tag_index[t].add(pid)

    context = {
        'data_view': dv,
        'projects': projects,
        'config': config,
        'settings': settings,
        'tag_index': tag_index,
        'project_index': project_index,
        'stack_index': stack_index,
        'stacks_of': stacks_of,
        'stackgroup_index': stackgroup_index,
        'stackgroups_of': stackgroups_of,
        'STATIC_URL': settings.STATIC_URL,
    }

    return HttpResponse( template.render( context ) )
