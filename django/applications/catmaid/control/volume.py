import json
import re

from catmaid.control.authentication import requires_user_role, can_edit_or_fail
from catmaid.models import UserRole, Project, Volume
from catmaid.serializers import VolumeSerializer

from django.db import connection
from django.http import HttpResponse
from django.shortcuts import get_object_or_404

from rest_framework.decorators import api_view
from rest_framework.response import Response


num = '[-+]?[0-9]*\.?[0-9]+'
bbox_re = r'BOX3D\(({0})\s+({0})\s+({0}),\s*({0})\s+({0})\s+({0})\)'.format(num)

def get_req_coordinate(request_dict, c):
    """Get a coordinate from a request dictionary or error.
    """
    v = request_dict.get(c, None)
    if not v:
        raise ValueError("Coordinate parameter %s missing." % c)
    return float(v)

def require_option(obj, field):
    """Raise an exception if a field is missing
    """
    if obj.has_key(field):
        return obj.get(field)
    else:
        raise ValueError("Parameter '{}' is missing".format(field))

def get_volume_instance(project_id, user_id, options):
    vtype = options.get("type", None)
    validate_vtype(vtype)

    init = volume_type.get(vtype)
    return init(project_id, user_id, options)

class PostGISVolume(object):
    """Volumes are supposed to create Volume model compatible data in the volume
    table by using PostGIS volumes.
    """

    def __init__(self, project_id, user_id, options):
        self.id = options.get('id', None)
        self.project_id = project_id
        self.user_id = user_id
        self.title = require_option(options, "title")
        self.comment = options.get("comment", None)

class TriangleMeshVolume(PostGISVolume):
    """A generic triangle mesh, provided from an external source.
    """
    def __init__(self, project_id, user_id, options):
        super(TriangleMeshVolume, self).__init__(project_id, user_id, options)
        json_mesh = options.get("mesh", None)
        self.mesh = json.loads(json_mesh) if json_mesh else None

    def save(self):

        params = {
            "uid": self.user_id,
            "pid": self.project_id,
            "t": self.title,
            "c": self.comment,
            "id": self.id
        }

        surface = TriangleMeshVolume.fromLists(self.mesh) if self.mesh else None
        cursor = connection.cursor()
        if self.id:
            # If surface is none, the old value will be used. This makes it
            # possible to update the volume without overriding its geometry.
            cursor.execute("""
                UPDATE catmaid_volume SET (user_id, project_id, editor_id, name,
                        comment, edition_time, geometry) =
                (%(uid)s, %(pid)s, %(uid)s, %(t)s, %(c)s, now(), """ +
                           (surface or "geometry") + """)
                WHERE id=%(id)s RETURNING id;""", params)
        else:
            if not surface:
                raise ValueError("Can't create new volume without mesh")

            cursor.execute("""
                INSERT INTO catmaid_volume (user_id, project_id, editor_id, name,
                        comment, creation_time, edition_time, geometry)
                VALUES (%(uid)s, %(pid)s, %(uid)s, %(t)s, %(c)s, now(), now(), """ +
                           surface + """)
                RETURNING id;""", params)

        return cursor.fetchone()[0]

    @classmethod
    def fromLists(cls, mesh):
        """Expect mesh to be a list of two lists: [[points], [triangles]]. The
        list of points contains lists of three numbers, each one representing a
        vertex in the mesh. The array of triangles also contains three element
        lists as items. Each one represents a triangle based on the points in
        the other array, that are referenced by the triangle index values.
        """
        def pg_point(p):
            return '{} {} {}'.format(p[0], p[1], p[2])

        def pg_face(points, f):
            p0 = pg_point(points[f[0]])
            return '(({}, {}, {}, {}))'.format(p0, pg_point(points[f[1]]),
                 pg_point(points[f[2]]), p0)

        points, faces = mesh
        triangles = [pg_face(points, f) for f in faces]
        return "ST_GeomFromEWKT('TIN (%s)')" % ','.join(triangles)

class BoxVolume(PostGISVolume):

    def __init__(self, options):
        super(BoxVolume, self).__init__(project_id, user_id, options);
        self.min_x = get_req_coordinate(options, "min_x")
        self.min_y = get_req_coordinate(options, "min_y")
        self.min_z = get_req_coordinate(options, "min_z")
        self.max_x = get_req_coordinate(options, "max_x")
        self.max_y = get_req_coordinate(options, "max_y")
        self.max_z = get_req_coordinate(options, "max_z")

    def save(self):
        """Create or update a PostGIS box in project space.

        An existing box is updated, if the ID parameter is None.
        """
        params = {
            "uid": self.user_id,
            "pid": self.project_id,
            "t": self.title,
            "c": self.comment,
            "lx": self.min_x,
            "ly": self.min_y,
            "lz": self.min_z,
            "hx": self.max_x,
            "hy": self.max_y,
            "hz": self.max_z,
            "id": self.id
        }

        surface = """ST_GeomFromEWKT('POLYHEDRALSURFACE (
            ((%(lx)s %(ly)s %(lz)s, %(lx)s %(hy)s %(lz)s, %(hx)s %(hy)s %(lz)s,
              %(hx)s %(ly)s %(lz)s, %(lx)s %(ly)s %(lz)s)),
            ((%(lx)s %(ly)s %(lz)s, %(lx)s %(hy)s %(lz)s, %(lx)s %(hy)s %(hz)s,
              %(lx)s %(ly)s %(hz)s, %(lx)s %(ly)s %(lz)s)),
            ((%(lx)s %(ly)s %(lz)s, %(hx)s %(ly)s %(lz)s, %(hx)s %(ly)s %(hz)s,
              %(lx)s %(ly)s %(hz)s, %(lx)s %(ly)s %(lz)s)),
            ((%(hx)s %(hy)s %(hz)s, %(hx)s %(ly)s %(hz)s, %(lx)s %(ly)s %(hz)s,
              %(lx)s %(hy)s %(hz)s, %(hx)s %(hy)s %(hz)s)),
            ((%(hx)s %(hy)s %(hz)s, %(hx)s %(ly)s %(hz)s, %(hx)s %(ly)s %(lz)s,
              %(hx)s %(hy)s %(lz)s, %(hx)s %(hy)s %(hz)s)),
            ((%(hx)s %(hy)s %(hz)s, %(hx)s %(hy)s %(lz)s, %(lx)s %(hy)s %(lz)s,
              %(lx)s %(hy)s %(hz)s, %(hx)s %(hy)s %(hz)s)))')"""
        cursor = connection.cursor()
        if self.id:
            cursor.execute("""
                UPDATE catmaid_volume SET (user_id, project_id, editor_id, name,
                        comment, edition_time, geometry) =
                (%(uid)s, %(pid)s, %(uid)s, %(t)s, %(c)s, now(), """ +
                           surface + """)
                WHERE id=%(id)s RETURNING id;""", params)
        else:
            cursor.execute("""
                INSERT INTO catmaid_volume (user_id, project_id, editor_id, name,
                        comment, creation_time, edition_time, geometry)
                VALUES (%(uid)s, %(pid)s, %(uid)s, %(t)s, %(c)s, now(), now(), """ +
                           surface + """)
                RETURNING id;""", params)

        return cursor.fetchone()[0]

volume_type = {
    "box": BoxVolume,
    "trimesh": TriangleMeshVolume
}

def validate_vtype(vtype):
    """Validate the given type or error.
    """
    if not vtype:
        raise ValueError("Type parameter missing. It should have one of the "
                "following options: " + volume_type.keys().join(", "))
    if vtype not in volume_type.keys():
        raise ValueError("Type has to be one of the following: " +
                volume_type.keys().join(", "))
    return vtype

@api_view(['GET'])
@requires_user_role([UserRole.Browse])
def volume_collection(request, project_id):
    """Get a collection of all available volumes.
    """
    if request.method == 'GET':
        p = get_object_or_404(Project, pk = project_id)
        # FIXME: Parsing our PostGIS geometry with GeoDjango doesn't work
        # anymore ince Django 1.8. Therefore, the geometry fields isn't read.
        # See: https://github.com/catmaid/CATMAID/issues/1250
        fields = ('id', 'name', 'comment', 'user', 'editor', 'project',
                'creation_time', 'edition_time')
        volumes = Volume.objects.filter(project_id=project_id).values(*fields)
        return Response(volumes)

@api_view(['GET', 'POST'])
@requires_user_role([UserRole.Browse])
def volume_detail(request, project_id, volume_id):
    """Get detailed information on a spatial volume or set its properties..

    The result will contain the bounding box of the volume's geometry. The
    response might might therefore be relatively large.
    """
    p = get_object_or_404(Project, pk = project_id)
    if request.method == 'GET':
        cursor = connection.cursor()
        cursor.execute("""
            SELECT id, project_id, name, comment, user_id, editor_id,
                creation_time, edition_time, Box3D(geometry)
            FROM catmaid_volume v
            WHERE id=%s and project_id=%s""",
            (volume_id, project_id))
        volume = cursor.fetchone()

        # Parse bounding box into dictionary, coming in format "BOX3D(0 0 0,1 1 1)"
        bbox_matches = re.search(bbox_re, volume[8])
        if not bbox_matches or len(bbox_matches.groups()) != 6:
            raise ValueError("Couldn't create bounding box for geometry")
        bbox = map(float, bbox_matches.groups())

        volume = {
            'id': volume[0],
            'project_id': volume[1],
            'name': volume[2],
            'comment': volume[3],
            'user_id': volume[4],
            'editor_id': volume[5],
            'creation_time': volume[6],
            'edition_time': volume[7],
            'bbox': {
                'min': {'x': bbox[0], 'y': bbox[1], 'z': bbox[2]},
                'max': {'x': bbox[3], 'y': bbox[4], 'z': bbox[5]}
            }
        }

        return Response(volume)
    elif request.method == 'POST':
        return update_volume(request, project_id=project_id, volume_id=volume_id)

@requires_user_role([UserRole.Annotate])
def update_volume(request, project_id, volume_id):
    """Update properties of an existing volume
    """
    if request.method != "POST":
        raise ValueError("Volume updates require a POST request")

    instance = get_volume_instance(project_id, request.user.id, request.POST)
    volume_id = instance.save()

    return Response({
        "success": True,
        "volume_id": volume_id
    })

@api_view(['POST'])
@requires_user_role([UserRole.Annotate])
def add_volume(request, project_id):
    """Create a new volume

    The ID of the newly created volume is returned. Currently only boxes are
    supported.
    ---
    parameters:
      - name: minx
        description: Minimum x coordinate of box
        paramType: form
        type: integer
        required: true
      - name: miny
        description: Minimum y coordinate of box
        paramType: form
        type: integer
        required: true
      - name: minz
        description: Minimum z coordinate of box
        paramType: form
        type: integer
        required: true
      - name: maxx
        description: Maximum x coordinate of box
        paramType: form
        type: integer
        required: true
      - name: maxy
        description: Maximum y coordinate of box
        paramType: form
        type: integer
        required: true
      - name: maxz
        description: Maximum z coordinate of box
        paramType: form
        type: integer
        required: true
      - name: title
        description: Title of box
        type: string
        required: true
      - name: type
        description: Type of volume (currently only box)
        type: string
        required: true
      - name: comment
        description: An optional comment
        type: string
        required: false
    type:
      'success':
        type: boolean
        required: true
      'volume_id':
        type: integer
        required: true
    """
    instance = get_volume_instance(project_id, request.user.id, request.POST)
    volume_id = instance.save()

    return Response({
        "success": True,
        "volume_id": volume_id
    })

@api_view(['GET'])
@requires_user_role([UserRole.Browse])
def intersects(request, project_id, volume_id):
    """Test if a point intersects with a given volume.
    ---
    parameters:
      - name: x
        description: X coordinate of point to test
        paramType: query
        type: number
      - name: y
        description: Y coordinate of point to test
        paramType: query
        type: number
      - name: z
        description: Z coordinate of point to test
        paramType: query
        type: number
    type:
      'intersects':
        type: boolean
        required: true
    """
    if request.method != 'GET':
        return

    p = get_object_or_404(Project, pk = project_id)
    x = request.GET.get('x', None)
    y = request.GET.get('y', None)
    z = request.GET.get('z', None)
    if None in (x,y,z):
        raise ValueError("Please provide valid X, Y and Z coordinates")

    x, y, z = float(x), float(y), float(z)

    # This test works only for boxes, because it only checks bouding box
    # overlap (&&& operator).
    cursor = connection.cursor()
    cursor.execute("""
        SELECT pt.geometry &&& catmaid_volume.geometry
        FROM (SELECT 'POINT(%s %s %s)'::geometry) AS pt, catmaid_volume
        WHERE catmaid_volume.id=%s""",
        (x, y, z, volume_id))

    result = cursor.fetchone()

    return HttpResponse(json.dumps({
        'intersects': result[0]
    }), content_type='application/json')
