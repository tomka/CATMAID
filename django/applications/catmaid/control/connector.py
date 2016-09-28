import json

from string import upper
from itertools import imap
from datetime import datetime, timedelta
from collections import defaultdict

from django.db import connection
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.http import HttpResponse, JsonResponse, Http404

from rest_framework.decorators import api_view

from catmaid import state
from catmaid.fields import Double3D
from catmaid.models import Project, Stack, ProjectStack, Connector, \
        ConnectorClassInstance, Treenode, TreenodeConnector, UserRole
from catmaid.control.authentication import requires_user_role, can_edit_or_fail
from catmaid.control.link import create_treenode_links
from catmaid.control.common import cursor_fetch_dictionary, \
        get_relation_to_id_map, get_request_list

@requires_user_role([UserRole.Annotate, UserRole.Browse])
def graphedge_list(request, project_id=None):
    """ Assumes that first element of skeletonlist is pre, and second is post """
    skeletonlist = get_request_list(request.POST, 'skeletonlist[]')
    skeletonlist = map(int, skeletonlist)
    p = get_object_or_404(Project, pk=project_id)
    edge = {}
    connectordata = {}

    qs_tc = TreenodeConnector.objects.filter(
        project=p,
        skeleton__in=skeletonlist ).select_related('relation__relation_name', 'connector__user', 'connector')

    for q in qs_tc:
        # Only look at synapse connectors
        if q.relation.relation_name not in ('presynaptic_to', 'postsynaptic_to'):
            continue
        if not q.connector_id in edge:
            # has to be a list, not a set, because we need matching treenode id
            edge[ q.connector_id ] = {'pre': [], 'post': [], 'pretreenode': [], 'posttreenode': []}
            connectordata[ q.connector_id ] = {
                'connector_id': q.connector_id,
                'x': q.connector.location_x,
                'y': q.connector.location_y,
                'z': q.connector.location_z,
                'user': q.connector.user.username }

        if q.relation.relation_name == 'presynaptic_to':
            edge[ q.connector_id ]['pre'].append( q.skeleton_id )
            edge[ q.connector_id ]['pretreenode'].append( q.treenode_id )
        elif q.relation.relation_name == 'postsynaptic_to':
            edge[ q.connector_id ]['post'].append( q.skeleton_id )
            edge[ q.connector_id ]['posttreenode'].append( q.treenode_id )

    result = []
    for k,v in edge.items():
        if skeletonlist[0] in v['pre'] and skeletonlist[1] in v['post']:
            connectordata[k]['pretreenode'] = v['pretreenode'][ v['pre'].index( skeletonlist[0] ) ]
            connectordata[k]['posttreenode'] = v['posttreenode'][ v['post'].index( skeletonlist[1] ) ]
            result.append(connectordata[k])

    return HttpResponse(json.dumps( result ), content_type='application/json')

@requires_user_role([UserRole.Annotate, UserRole.Browse])
def one_to_many_synapses(request, project_id=None):
    """ Return the list of synapses of a specific kind between one skeleton and a list of other skeletons. """
    if 'skid' not in request.POST:
        raise ValueError("No skeleton ID for 'one' provided")
    skid = int(request.POST.get('skid'))

    skids = get_request_list(request.POST, 'skids', map_fn=int)
    if not skids:
        raise ValueError("No skeleton IDs for 'many' provided")

    relation_name = request.POST.get('relation') # expecting presynaptic_to, postsynaptic_to, or gapjunction_with

    rows = _many_to_many_synapses([skid], skids, relation_name, project_id)
    return HttpResponse(json.dumps(rows))


@requires_user_role(UserRole.Browse)
def many_to_many_synapses(request, project_id=None):
    """
    Return the list of synapses of a specific kind between one list of
    skeletons and a list of other skeletons.
    """
    skids1 = get_request_list(request.POST, 'skids1', map_fn=int)
    if not skids1:
        raise ValueError("No skeleton IDs for first list of 'many' provided")
    skids2 = get_request_list(request.POST, 'skids2', map_fn=int)
    if not skids2:
        raise ValueError("No skeleton IDs for second list 'many' provided")

    relation_name = request.POST.get('relation') # expecting presynaptic_to, postsynaptic_to, or gapjunction_with

    rows = _many_to_many_synapses(skids1, skids2, relation_name, project_id)
    return HttpResponse(json.dumps(rows))


def _many_to_many_synapses(skids1, skids2, relation_name, project_id):
    """
    Return all rows that connect skeletons of one set with another set with a
    specific relation.
    """
    if relation_name not in ('postsynaptic_to', 'presynaptic_to', 'gapjunction_with'):
        raise Exception("Cannot accept a relation named '%s'" % relation_name)

    cursor = connection.cursor()

    relations = get_relation_to_id_map(project_id, cursor=cursor)
    gapjunction_id = relations.get('gapjunction_with', -1)

    cursor.execute('''
    SELECT tc1.connector_id, c.location_x, c.location_y, c.location_z,
           tc1.treenode_id, tc1.skeleton_id, tc1.confidence, tc1.user_id,
           t1.location_x, t1.location_y, t1.location_z,
           tc2.treenode_id, tc2.skeleton_id, tc2.confidence, tc2.user_id,
           t2.location_x, t2.location_y, t2.location_z
    FROM treenode_connector tc1,
         treenode_connector tc2,
         treenode t1,
         treenode t2,
         relation r1,
         connector c
    WHERE tc1.skeleton_id IN (%s)
      AND tc1.connector_id = c.id
      AND tc2.skeleton_id IN (%s)
      AND tc1.connector_id = tc2.connector_id
      AND tc1.relation_id = r1.id
      AND r1.relation_name = '%s'
      AND (tc1.relation_id != tc2.relation_id OR tc1.relation_id = %d)
      AND tc1.id != tc2.id
      AND tc1.treenode_id = t1.id
      AND tc2.treenode_id = t2.id
    ''' % (','.join(map(str, skids1)),
           ','.join(map(str, skids2)),
           relation_name,
           gapjunction_id))

    return tuple((row[0], (row[1], row[2], row[3]),
                  row[4], row[5], row[6], row[7],
                  (row[8], row[9], row[10]),
                  row[11], row[12], row[13], row[14],
                  (row[15], row[16], row[17])) for row in cursor.fetchall())

@api_view(['GET'])
@requires_user_role([UserRole.Annotate, UserRole.Browse])
def list_connector(request, project_id=None):
    """Get connectors linked to a set of skeletons.

    The result data set includes information about linked connectors on a given
    input set of skeletons. These links are further constrained by relation
    type, with currently support available for: postsynaptic_to,
    presynaptic_to, abutting, gapjunction_with.

    Returned is an object containing an array of links to connectors and a set
    of tags for all connectors found (if not disabled). The link array contains
    one array per connector link with the following content: [Linked skeleton ID,
    Connector ID, Connector X, Connector Y, Connector Z, Link confidence, Link
    creator ID, Linked treenode ID, Link edit time].
    ---
    parameters:
      - name: skeleton_ids
        description: Skeletons to list connectors for
        type: array
        items:
          type: integer
        paramType: form
        required: true
      - name: relation_type
        description: Relation of listed connector links
        type: string
        paramType: form
        required: true
      - name: with_tags
        description: If connector tags should be fetched
        type: boolean
        paramType: form
        defaultValue: true
        required: false
    type:
      links:
        type: array
        items:
          type: array
          items:
            type: string
        description: Matching connector links
        required: true
      tags:
         type array
    """
    skeleton_ids = get_request_list(request.GET, 'skeleton_ids', map_fn=int)

    if not skeleton_ids:
        raise ValueError("At least one skeleton ID required")

    relation_type = request.GET.get('relation_type', 'presynaptic_to')
    with_tags = request.GET.get('with_tags', 'true') == 'true'

    cursor = connection.cursor()
    relation_map = get_relation_to_id_map(project_id, cursor=cursor)
    relation_id = relation_map.get(relation_type)
    if not relation_id:
        raise ValueError("Unknown relation: " + relation_type)

    sk_template = ",".join(("(%s)",) * len(skeleton_ids))

    cursor.execute('''
        SELECT tc.skeleton_id, c.id, c.location_x, c.location_y, c.location_z,
              tc.confidence, tc.user_id, tc.treenode_id, tc.edition_time
        FROM treenode_connector tc
        JOIN (VALUES {}) q_skeleton(id)
            ON tc.skeleton_id = q_skeleton.id
        JOIN (VALUES (%s)) q_relation(id)
            ON tc.relation_id = q_relation.id
        JOIN connector c
            ON tc.connector_id = c.id
    '''.format(sk_template), skeleton_ids + [relation_id])

    links = cursor.fetchall()
    connector_ids = [l[0] for l in links]
    tags = defaultdict(list)
    if connector_ids > 0 and with_tags:
        c_template = ",".join(("(%s)",) * len(connector_ids))
        cursor.execute('''
            SELECT q_connector.id, ci.name
            FROM connector_class_instance cci
            JOIN (VALUES {}) q_connector(id)
                ON cci.id = q_connector.id
            JOIN (VALUES (%s)) q_relation(id)
                ON cci.relation_id = q_relation.id
            JOIN class_instance ci
                ON cci.class_instance_id = ci.id
        '''.format(c_template), connector_ids + [relation_map['labeled_as']])
        for row in cursor.fetchall():
            tags[row[0]].append(row[1])

        # Sort labels by name
        for connector_id, labels in tags.iteritems():
            labels.sort(key=upper)

    return JsonResponse({
        "links": links,
        "tags": tags
    }, safe=False)

def get_connector_list(project_id, skeleton_id, relation_type, display_start,
                       display_length, sorting_column, sort_descending):

    def empty_result():
        return {
            'total_count': 0,
            'links': []
        }

    if not skeleton_id:
        return empty_result()
    else:
        skeleton_id = int(skeleton_id)

    response_on_error = ''
    try:
        cursor = connection.cursor()
        response_on_error = 'Could not fetch relations.'
        relation_map = get_relation_to_id_map(project_id, cursor=cursor)
        for rel in ['presynaptic_to', 'postsynaptic_to', 'element_of', 'labeled_as']:
            if rel not in relation_map:
                raise Exception('Failed to find the required relation %s' % rel)

        relation_type_id = relation_map.get(relation_type)
        if relation_map is None:
            raise ValueError("Unknown relation type: " + relation_type)

        if relation_type == 'presynaptic_to':
            inverse_relation_type_id = relation_map['postsynaptic_to']
        elif relation_type == 'postsynaptic_to':
            inverse_relation_type_id = relation_map['presynaptic_to']
        elif relation_type in ('abutting', 'gapjunction_with'):
            # For abutting and gap junction relations, the inverse is expected
            # to be the same relation.
            inverse_relation_type_id = relation_type_id
        else:
            raise ValueError("Unsupported relation type: " + relation_type)

        response_on_error = 'Failed to select connectors.'
        cursor.execute(
            '''
            SELECT
            connector.id AS connector_id,
            tn_other.user_id AS connector_user_id,
            treenode_user.username AS connector_username,
            connector.location_x AS connector_x,
            connector.location_y AS connector_y,
            connector.location_z AS connector_z,
            tn_other.id AS other_treenode_id,
            tn_other.location_x AS other_treenode_x,
            tn_other.location_y AS other_treenode_y,
            tn_other.location_z AS other_treenode_z,
            tn_other.skeleton_id AS other_skeleton_id,
            tn_this.location_x AS this_treenode_x,
            tn_this.location_y AS this_treenode_y,
            tn_this.location_z AS this_treenode_z,
            tn_this.id AS this_treenode_id,
            tc_this.relation_id AS this_to_connector_relation_id,
            tc_this.confidence AS confidence,
            tc_other.relation_id AS connector_to_other_relation_id,
            tc_other.confidence AS target_confidence,
            connector.edition_time AS last_modified
            FROM
            treenode tn_other,
            treenode_connector tc_other,
            connector,
            "auth_user" treenode_user,
            treenode_connector tc_this,
            treenode tn_this
            WHERE
            treenode_user.id = tn_other.user_id AND
            tn_other.id = tc_other.treenode_id AND
            tc_other.connector_id = connector.id AND
            tc_other.relation_id = %s AND
            tc_this.connector_id = connector.id AND
            tn_this.id = tc_this.treenode_id AND
            tn_this.skeleton_id = %s AND
            tc_this.relation_id = %s AND
            tn_this.id <> tn_other.id
            ORDER BY
            connector_id, other_treenode_id, this_treenode_id
            ''',  [inverse_relation_type_id, skeleton_id, relation_type_id])

        connectors = cursor_fetch_dictionary(cursor)
        connected_skeletons = map(lambda con: con['other_skeleton_id'], connectors)
        connector_ids = map(lambda con: con['connector_id'], connectors)

        response_on_error = 'Failed to find counts of treenodes in skeletons.'
        skel_tn_count = Treenode.objects.filter(skeleton__in=connected_skeletons)\
        .values('skeleton').annotate(treenode_count=Count('skeleton'))
        # .values to group by skeleton_id. See http://tinyurl.com/dj-values-annotate

        skeleton_to_treenode_count = {}
        for s in skel_tn_count:
            skeleton_to_treenode_count[s['skeleton']] = s['treenode_count']

        # Rather than do a LEFT OUTER JOIN to also include the connectors
        # with no partners, just do another query to find the connectors
        # without the conditions:

        response_on_error = 'Failed to select all connectors.'
        cursor.execute(
            '''
            SELECT
            connector.id AS connector_id,
            connector.user_id AS connector_user_id,
            connector_user.username AS connector_username,
            connector.location_x AS connector_x,
            connector.location_y AS connector_y,
            connector.location_z AS connector_z,
            tn_this.id AS this_treenode_id,
            tc_this.relation_id AS this_to_connector_relation_id,
            tc_this.confidence AS confidence,
            tn_this.location_x AS this_treenode_x,
            tn_this.location_y AS this_treenode_y,
            tn_this.location_z AS this_treenode_z,
            connector.edition_time AS last_modified
            FROM
            connector,
            "auth_user" connector_user,
            treenode_connector tc_this,
            treenode tn_this
            WHERE
            connector_user.id = connector.user_id AND
            tc_this.connector_id = connector.id AND
            tn_this.id = tc_this.treenode_id AND
            tn_this.skeleton_id = %s AND
            tc_this.relation_id = %s
            ORDER BY
            connector_id, this_treenode_id
            ''',  [skeleton_id, relation_type_id])
        for row in cursor_fetch_dictionary(cursor):
            connector_id = row['connector_id']
            if connector_id not in connector_ids:
                connectors.append(row)
                connector_ids.append(connector_id)

        # For each of the connectors, find all of its labels:
        response_on_error = 'Failed to find the labels for connectors'
        if (connector_ids > 0):
            connector_labels = ConnectorClassInstance.objects.filter(
                project=project_id,
                connector__in=connector_ids,
                relation=relation_map['labeled_as']).values(
                'connector',
                'class_instance__name')

            labels_by_connector = {}  # Key: Connector ID, Value: List of labels.
            for label in connector_labels:
                if label['connector'] not in labels_by_connector:
                    labels_by_connector[label['connector']] = [label['class_instance__name']]
                else:
                    labels_by_connector[label['connector']].append(label['class_instance__name'])
                # Sort labels by name
            for labels in labels_by_connector.values():
                labels.sort(key=upper)

        total_result_count = len(connectors)

        if 0 == total_result_count:
            return empty_result()

        # Paging
        if display_length == -1:
            connectors = connectors[display_start:]
            connector_ids = connector_ids[display_start:]
        else:
            connectors = connectors[display_start:display_start + display_length]
            connector_ids = connector_ids[display_start:display_start + display_length]

        # Format output
        aaData_output = []
        for c in connectors:
            response_on_error = 'Failed to format output for connector with ID %s.' % c['connector_id']
            if 'other_skeleton_id' in c:
                connected_skeleton_treenode_count = skeleton_to_treenode_count[c['other_skeleton_id']]
            else:
                c['other_skeleton_id'] = skeleton_id
                c['other_treenode_id'] = c['this_treenode_id']
                c['other_treenode_x'] = c['this_treenode_x']
                c['other_treenode_y'] = c['this_treenode_y']
                c['other_treenode_z'] = c['this_treenode_z']
                c['target_confidence'] = ''
                connected_skeleton_treenode_count = 0

            if c['connector_id'] in labels_by_connector:
                labels = ', '.join(map(str, labels_by_connector[c['connector_id']]))
            else:
                labels = ''

            row = []
            row.append(c['connector_id'])
            row.append(c['other_skeleton_id'])
            row.append(c['other_treenode_x']) #('%.2f' % )
            row.append(c['other_treenode_y'])
            z = c['other_treenode_z']
            row.append(z)
            row.append(c['confidence'])
            row.append(c['target_confidence'])
            row.append(labels)
            row.append(connected_skeleton_treenode_count)
            row.append(c['connector_username'])
            row.append(c['other_treenode_id'])
            row.append(str(c['last_modified'].isoformat()))
            aaData_output.append(row)

        # Sort output
        def fetch_value_for_sorting(row):
            value = row[sorting_column]
            if isinstance(value, str) or isinstance(value, unicode):
                return upper(value)
            return value
        aaData_output.sort(key=fetch_value_for_sorting)

        # Fix excessive decimal precision in coordinates
        for row in aaData_output:
            row[2] = float('%.2f' % row[2])
            row[3] = float('%.2f' % row[3])
            row[4] = float('%.2f' % row[4])

        if sort_descending:
            aaData_output.reverse()

        return {
            'total_count': total_result_count,
            'links': aaData_output
        }

    except Exception as e:
        import traceback
        raise Exception("%s: %s %s" % (response_on_error, str(e),
                                       str(traceback.format_exc())))

def _connector_skeletons(connector_ids, project_id):
    """ Return a dictionary of connector ID as keys and a dictionary as value
    containing two entries: 'presynaptic_to' with a skeleton ID or None,
    and 'postsynaptic_to' with a list of skeleton IDs (maybe empty). """
    cursor = connection.cursor()

    relations = get_relation_to_id_map(project_id, ('presynaptic_to', 'postsynaptic_to'), cursor)
    PRE = relations['presynaptic_to']
    POST = relations['postsynaptic_to']

    cursor.execute('''
    SELECT connector_id, relation_id, skeleton_id, treenode_id
    FROM treenode_connector
    WHERE connector_id IN (%s)
      AND (relation_id = %s OR relation_id = %s)
    ''' % (",".join(map(str, connector_ids)), PRE, POST))

    cs = {}
    for row in cursor.fetchall():
        c = cs.get(row[0])
        if not c:
            # Ensure each connector has the two entries at their minimum
            c = {'presynaptic_to': None, 'postsynaptic_to': [],
                 'presynaptic_to_node': None, 'postsynaptic_to_node': []}
            cs[row[0]] = c
        if POST == row[1]:
            c['postsynaptic_to'].append(row[2])
            c['postsynaptic_to_node'].append(row[3])
        elif PRE == row[1]:
            c['presynaptic_to'] = row[2]
            c['presynaptic_to_node'] = row[3]

    return cs

@requires_user_role([UserRole.Browse, UserRole.Annotate])
def connector_skeletons(request, project_id=None):
    """ See _connector_skeletons """
    connector_ids = get_request_list(request.POST, 'connector_ids', map_fn=int)
    cs = tuple(_connector_skeletons(connector_ids, project_id).iteritems())
    return HttpResponse(json.dumps(cs))


def _connector_associated_edgetimes(connector_ids, project_id):
    """ Return a dictionary of connector ID as keys and a dictionary as value
    containing two entries: 'presynaptic_to' with a skeleton ID of None,
    and 'postsynaptic_to' with a list of skeleton IDs (maybe empty) including
    the timestamp of the edge. """
    cursor = connection.cursor()

    relations = get_relation_to_id_map(project_id, ('presynaptic_to', 'postsynaptic_to'), cursor)
    PRE = relations['presynaptic_to']
    POST = relations['postsynaptic_to']

    cursor.execute('''
    SELECT connector_id, relation_id, skeleton_id, treenode_id, creation_time
    FROM treenode_connector
    WHERE connector_id IN (%s)
      AND (relation_id = %s OR relation_id = %s)
    ''' % (",".join(map(str, connector_ids), PRE, POST)))

    cs = {}
    for row in cursor.fetchall():
        c = cs.get(row[0])
        if not c:
            # Ensure each connector has the two entries at their minimum
            c = {'presynaptic_to': None, 'postsynaptic_to': []}
            cs[row[0]] = c
        if POST == row[1]:
            c['postsynaptic_to'].append( (row[2], row[3], row[4]) )
        elif PRE == row[1]:
            c['presynaptic_to'] = (row[2], row[3], row[4])

    return cs

@requires_user_role([UserRole.Browse, UserRole.Annotate])
def connector_associated_edgetimes(request, project_id=None):
    """ See _connector_associated_edgetimes """
    connector_ids = get_request_list(request.POST, 'connector_ids', map_fn=int)

    def default(obj):
        """Default JSON serializer."""
        import calendar, datetime

        if isinstance(obj, datetime.datetime):
            if obj.utcoffset() is not None:
                obj = obj - obj.utcoffset()
            millis = int(
                calendar.timegm(obj.timetuple()) * 1000 +
                obj.microsecond / 1000
            )
        return millis

    return HttpResponse(json.dumps(_connector_associated_edgetimes(connector_ids, project_id), default=default))

@requires_user_role(UserRole.Annotate)
def create_connector(request, project_id=None):
    query_parameters = {}
    default_values = {'x': 0, 'y': 0, 'z': 0, 'confidence': 5}
    for p in default_values.keys():
        query_parameters[p] = request.POST.get(p, default_values[p])

    project_id = int(project_id)

    parsed_confidence = int(query_parameters['confidence'])
    if parsed_confidence < 1 or parsed_confidence > 5:
        return HttpResponse(json.dumps({'error': 'Confidence not in range 1-5 inclusive.'}))

    cursor = connection.cursor()

    # Get optional initial links to connectors, expect each entry to be a list
    # of connector ID, relation ID and confidence.
    links = get_request_list(request.POST, 'links', [], map_fn=int)

    new_connector = Connector(
        user=request.user,
        editor=request.user,
        project=Project.objects.get(id=project_id),
        location_x=float(query_parameters['x']),
        location_y=float(query_parameters['y']),
        location_z=float(query_parameters['z']),
        confidence=parsed_confidence)
    new_connector.save()

    # Create all initial links
    if links:
        created_links = create_treenode_links(project_id, request.user.id,
                new_connector.id, links, cursor)
    else:
        created_links = []

    return JsonResponse({
        'connector_id': new_connector.id,
        'connector_edition_time': new_connector.edition_time,
        'created_links': created_links
    })


@requires_user_role(UserRole.Annotate)
def delete_connector(request, project_id=None):
    connector_id = int(request.POST.get("connector_id", 0))
    can_edit_or_fail(request.user, connector_id, 'connector')

    # Check provided state
    cursor = connection.cursor()
    state.validate_state(connector_id, request.POST.get('state'),
            node=True, c_links=True, lock=True, cursor=cursor)

    # Get connector and partner information
    connectors = list(Connector.objects.filter(id=connector_id).prefetch_related(
            'treenodeconnector_set', 'treenodeconnector_set__relation'))
    if 1 != len(connectors):
        raise ValueError("Couldn't find exactly one connector with ID #" +
                connector_id)
    connector = connectors[0]
    # TODO: Check how many queries here are generated
    partners = [{
        'id': p.treenode_id,
        'edition_time': p.treenode.edition_time,
        'rel': p.relation.relation_name,
        'rel_id': p.relation.id,
        'confidence': p.confidence,
        'link_id': p.id
    } for p in connector.treenodeconnector_set.all()]
    connector.delete()
    return JsonResponse({
        'message': 'Removed connector and class_instances',
        'connector_id': connector_id,
        'confidence': connector.confidence,
        'x': connector.location_x,
        'y': connector.location_y,
        'z': connector.location_z,
        'partners': partners
    })


@requires_user_role(UserRole.Browse)
def list_completed(request, project_id):
    completed_by = request.GET.get('completed_by', None)
    from_date = request.GET.get('from', None)
    to_date = request.GET.get('to', None)

    # Sanitize
    if completed_by:
        completed_by = int(completed_by)
    if from_date:
        from_date = datetime.strptime(from_date, '%Y%m%d')
    if to_date:
        to_date = datetime.strptime(to_date, '%Y%m%d')

    response = _list_completed(project_id, completed_by, from_date, to_date)
    return HttpResponse(json.dumps(response), content_type="application/json")


def _list_completed(project_id, completed_by=None, from_date=None, to_date=None):
    """ Get a list of connector links that can be optionally constrained to be
    completed by a certain user in a given time frame. The returned connector
    links are by default only constrained by both sides having different
    relations and the first link was created before the second one.
    """
    cursor = connection.cursor()

    relations = get_relation_to_id_map(project_id, ('presynaptic_to', 'postsynaptic_to'), cursor)
    pre = relations['presynaptic_to']
    post = relations['postsynaptic_to']

    params = [project_id, pre, post, pre, post]
    query = '''
        SELECT tc2.connector_id, c.location_x, c.location_y, c.location_z,
            tc2.treenode_id, tc2.skeleton_id, tc2.confidence, tc2.user_id,
            t2.location_x, t2.location_y, t2.location_z,
            tc1.treenode_id, tc1.skeleton_id, tc1.confidence, tc1.user_id,
            t1.location_x, t1.location_y, t1.location_z
        FROM treenode_connector tc1
        JOIN treenode_connector tc2 ON tc1.connector_id = tc2.connector_id
        JOIN connector c ON tc1.connector_id = c.id
        JOIN treenode t1 ON t1.id = tc1.treenode_id
        JOIN treenode t2 ON t2.id = tc2.treenode_id
        WHERE t1.project_id=%s
        AND tc1.relation_id <> tc2.relation_id
        AND tc1.creation_time > tc2.creation_time
        AND (tc1.relation_id = %s OR tc1.relation_id = %s)
        AND (tc2.relation_id = %s OR tc2.relation_id = %s)'''

    if completed_by:
        params.append(completed_by)
        query += " AND tc1.user_id=%s"
    if from_date:
        params.append(from_date.isoformat())
        query += " AND tc1.creation_time >= %s"
    if to_date:
        to_date =  to_date + timedelta(days=1)
        params.append(to_date.isoformat())
        query += " AND tc1.creation_time < %s"

    cursor.execute(query, params)

    return tuple((row[0], (row[1], row[2], row[3]),
                  row[4], row[5], row[6], row[7],
                  (row[8], row[9], row[10]),
                  row[11], row[12], row[13], row[14],
                  (row[15], row[16], row[17])) for row in cursor.fetchall())


@requires_user_role(UserRole.Browse)
def connectors_info(request, project_id):
    """
    Given a list of connectors, a list of presynaptic skeletons and a list of
    postsynatic skeletons, return a list of rows, one per synaptic connection,
    in the same format as one_to_many_synapses. The list of connectors (cids),
    pre-skeletons (pre) and post-skeletons (post) is optional.
    """

    cids = get_request_list(request.POST, 'cids', map_fn=int)
    skids = get_request_list(request.POST, 'skids', map_fn=int)
    skids_pre = get_request_list(request.POST, 'pre', map_fn=int)
    skids_post = get_request_list(request.POST, 'post', map_fn=int)

    cursor = connection.cursor()

    if skids_pre or skids_post:
        if skids:
            raise ValueError("The skids parameter can't be used together with "
                    "pre and/or post.")

        relations = get_relation_to_id_map(project_id, ('presynaptic_to', 'postsynaptic_to'), cursor)
        pre = relations['presynaptic_to']
        post = relations['postsynaptic_to']
    else:
        pre = post = None

    # Construct base query
    query_parts = ['''
        SELECT DISTINCT
               tc1.connector_id, c.location_x, c.location_y, c.location_z,
               tc1.treenode_id, tc1.skeleton_id, tc1.confidence, tc1.user_id,
               t1.location_x, t1.location_y, t1.location_z,
               tc2.treenode_id, tc2.skeleton_id, tc2.confidence, tc2.user_id,
               t2.location_x, t2.location_y, t2.location_z
        FROM connector c
    ''']

    query_params = []

    # Add connector filter, if requested
    if cids:
        cid_template = ",".join(("(%s)",) * len(cids))
        query_parts.append('''
            JOIN (VALUES {}) rc(id) ON c.id = rc.id
        '''.format(cid_template))
        query_params.extend(cids)

    # Add pre-synaptic skeleton filter, if requested
    query_parts.append('''
        JOIN treenode_connector tc1 ON tc1.connector_id = c.id
        JOIN treenode t1 ON tc1.treenode_id = t1.id
    ''')
    if skids_pre:
        pre_skid_template = ",".join(("(%s)",) * len(skids_pre))
        query_parts.append('''
            JOIN (VALUES {}) sk_pre(id) ON tc1.skeleton_id = sk_pre.id
        '''.format(pre_skid_template))
        query_params.extend(skids_pre)

    # Add post-synaptic skeleton filter, if requested
    query_parts.append('''
        JOIN treenode_connector tc2 ON tc2.connector_id = c.id
        JOIN treenode t2 ON tc2.treenode_id = t2.id
    ''')
    if skids_post:
        post_skid_template = ",".join(("(%s)",) * len(skids_post))
        query_parts.append('''
            JOIN (VALUES {}) sk_post(id) ON tc2.skeleton_id = sk_post.id
        '''.format(post_skid_template))
        query_params.extend(skids_post)

    # Add generic skeleton filters
    if skids:
        skid_template = ",".join(("(%s)",) * len(skids))
        query_parts.append('''
            JOIN (VALUES {}) sk(id) ON tc1.skeleton_id = sk.id OR tc2.skeleton_id = sk.id
        '''.format(skid_template))
        query_params.extend(skids)

    # Prevent self-joins of connector partners
    query_parts.append('''
        WHERE tc1.id != tc2.id
    ''')

    # Pre-synaptic skeleton filters also constrain the relation
    if skids_pre:
        query_parts.append('''
            AND tc1.relation_id = %s
        ''')
        query_params.append(pre)

    # Post-synaptic skeleton filters also constrain the relation
    if skids_post:
        query_parts.append('''
            AND tc2.relation_id = %s
        ''')
        query_params.append(post)

    if skids:
        query_parts.append('''
            AND tc1.treenode_id < tc2.treenode_id
        ''')

    query_parts.append('''
        ORDER BY tc2.skeleton_id
    ''')

    cursor.execute("\n".join(query_parts), query_params)

    rows = tuple((row[0], (row[1], row[2], row[3]),
                  row[4], row[5], row[6], row[7],
                  (row[8], row[9], row[10]),
                  row[11], row[12], row[13], row[14],
                  (row[15], row[16], row[17])) for row in cursor.fetchall())

    return HttpResponse(json.dumps(rows))

@requires_user_role([UserRole.Browse])
def connector_user_info(request, project_id):
    """ Return information on a treenode connector edge.

    This function is called often (every connector mouseover) and should
    therefore be as fast as possible. Analogous to user_info for treenodes and
    connectors.
    """
    treenode_id = int(request.GET.get('treenode_id'))
    connector_id = int(request.GET.get('connector_id'))
    cursor = connection.cursor()
    relation_names = ('presynaptic_to', 'postsynaptic_to', 'abutting', 'gapjunction_with')
    relations = get_relation_to_id_map(project_id, relation_names, cursor)
    relation_id = relations[request.GET.get('relation_name')]
    cursor.execute('''
        SELECT tc.id, tc.user_id, tc.creation_time, tc.edition_time
        FROM treenode_connector tc
        WHERE tc.treenode_id = %s
          AND tc.connector_id = %s
          AND tc.relation_id = %s
                   ''', (treenode_id, connector_id, relation_id))

    # We expect at least one result node.
    if not cursor.rowcount:
        return HttpResponse(json.dumps({
            'error': 'No treenode connector exists for treenode %s, connector %s, relation %s' %
            (treenode_id, connector_id, relation_id)}))

    # Build result. Because there is no uniqueness restriction on treenode
    # connector edges, even with the same relation, the response must handle
    # multiple rows.
    return HttpResponse(json.dumps([{
        'user': info[1],
        'creation_time': str(info[2].isoformat()),
        'edition_time': str(info[3].isoformat()),
    } for info in cursor.fetchall()]))

@api_view(['GET'])
@requires_user_role([UserRole.Browse])
def connector_detail(request, project_id, connector_id):
    """Get detailed information on a connector and its partners
    ---
    models:
      connector_partner_element:
        id: connector_partner_element
        properties:
          link_id:
            type: integer
            description: ID of link between connector and partner
            required: true
          partner_id:
            type: integer
            description: ID of partner
            required: true
          confidence:
            type: integer
            description: Confidence of connection between connector and partner
            required: true
          skeleton_id:
            type: integer
            description: ID of partner skeleton
            required: true
          relation_id:
            type: integer
            description: ID of relation between connector and partner
            required: true
          relation_name:
            type: integer
            description: Name of relation between connector and partner
            required: true
    type:
      connector_id:
        type: integer
        description: ID of connector
        required: true
      x:
        type: number
        description: X coordinate of connector location
        required: true
      y:
        type: number
        description: Y coordinate of connector location
        required: true
      z:
        type: number
        description: Z coordinate of connector location
        required: true
      confidence:
        type: integer
        description: Integer in range 1-5 with 1 being most confident
        required: true
      partners:
        type: array
        description: Partners of this connector
        items:
          $ref: connector_partner_element
    """
    connector_id = int(connector_id)
    cursor = connection.cursor()
    cursor.execute("""
        SELECT c.id, c.location_x, c.location_y, c.location_z, c.confidence,
               json_agg(json_build_object(
                    'link_id', tc.id,
                    'partner_id', tc.treenode_id,
                    'confidence', tc.confidence,
                    'skeleton_id', tc.skeleton_id,
                    'relation_id', tc.relation_id,
                    'relation_name', r.relation_name)) AS partners
        FROM connector c, treenode_connector tc, relation r
        WHERE c.id = %s AND c.id = tc.connector_id AND r.id = tc.relation_id
        GROUP BY c.id
    """, (connector_id, ))
    detail = cursor.fetchone()

    if not detail:
        raise Http404("Connector does not exist: " + str(connector_id))

    return JsonResponse({
        'connector_id': detail[0],
        'x': detail[1],
        'y': detail[2],
        'z': detail[3],
        'confidence': detail[4],
        'partners': [p for p in detail[5]]
    })
