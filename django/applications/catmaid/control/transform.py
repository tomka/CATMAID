# -*- coding: utf-8 -*-

from rest_framework.decorators import api_view

from catmaid.control.authentication import requires_user_role
from catmaid.models import UserRole, Project


@api_view(['POST'])
@requires_user_role([UserRole.Browse])
def transform(request, project_id):
    """Transform a set of input points from one space to another. This can be a
    time consuming operation for large inputs.
    ---
    parameters:
      - name: project_id
        description: Project to operate in
        type: integer
        paramType: path
        required: true
      - name: source_type
        description: the type of source data
        paramType: form
        type: string
        enum: ["skeleton_id", "neuron_id", "point", "pointlist"]
    """
    return None
