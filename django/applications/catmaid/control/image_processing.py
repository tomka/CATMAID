import datetime

from django.db import models
from django.conf import settings
from django.http import HttpResponse
from django.shortcuts import get_object_or_404

from catmaid.models import Project, Stack

from celery.task import task
from pgmagick import Blob, Image, Geometry, Color, CompositeOperator as co, ResolutionType, ChannelType as ch, QuantumOperator as qo
import urllib2 as urllib
from celery.task import task

class ProcessingJob:
    """ A container that keeps data about a procssing job to be done.
    """
    def __init__( self, project_id, stack_ids, section, x, y, zoom_level, thresholds, intensities ):
        self.project_id = int(project_id)
        # Get access to the model
        project = get_object_or_404(Project, pk=project_id)
        self.stack_ids = stack_ids
        self.section = section
        self.x = x
        self.y = y
        self.zoom_level = zoom_level
        self.thresholds = thresholds
        self.intensities = intensities

def create_tile_url( base, section, x, y, zoom_level, ext ):
    """ Creates a common CATDMAID tile URL.
    """
    return "{0}{1}/{2}_{3}_{4}.{5}".format( base, section, y, x, zoom_level, ext )

def create_tile(request, project_id=None, stack_ids=None, section=None, x=None, y=None, zoom_level=None, thresholds=None, intensities=None):
    """ Creates a tile based on the tiles at the given position in the
    given stacks. The intensities are percentage values (i.e. 100 = no
    change). For now, the colors for the different channels are fixed:
    blue, green, magenta and greys for the rest. This will change in
    the future.
    """
    # Make a list out of the stack ids
    string_list = stack_ids.split(",")
    stack_ids = [int( i ) for i in string_list]
    # Make a list out of the intensities
    string_list = intensities.split(",")
    intensities = [float( i ) for i in string_list]
    # Make a list out of the thresholds
    if thresholds is None:
        thresholds = [0 for i in intensities]
    else:
        string_list = thresholds.split(",")
        thresholds = [int( i ) for i in string_list]

    job = ProcessingJob( project_id, stack_ids, section, x, y, zoom_level, thresholds, intensities )

    return process( job )

def process( job ):
    # TODO: Access tile size information through Django model
    geometry = Geometry(256, 256)
    color = Color("black")
    composite = Image(geometry, color)

    for n, s in enumerate( job.stack_ids ):
        stack = get_object_or_404(Stack, pk=s)
        img_url = create_tile_url( stack.image_base, job.section, job.x, job.y, job.zoom_level, stack.file_extension )
        img_file = urllib.urlopen( img_url, timeout=30 )
        blob = Blob( img_file.read() )
        image = Image( blob )
        del blob

        # Channel selection
        if n == 0:
            # Channel 0 is blue
            image.quantumOperator( ch.RedChannel, qo.AssignQuantumOp, 0 )
            image.quantumOperator( ch.GreenChannel, qo.AssignQuantumOp, 0 )
            image.quantumOperator( ch.BlueChannel, qo.ThresholdBlackQuantumOp, job.thresholds[n] )
        elif n == 1:
            # Channel 1 is green
            image.quantumOperator( ch.RedChannel, qo.AssignQuantumOp, 0 )
            image.quantumOperator( ch.BlueChannel, qo.AssignQuantumOp, 0 )
            image.quantumOperator( ch.GreenChannel, qo.ThresholdBlackQuantumOp, job.thresholds[n] )
        elif n == 2:
            # Channel 2 is magenta
            image.quantumOperator( ch.GreenChannel, qo.AssignQuantumOp, 0 )
            image.quantumOperator( ch.BlueChannel, qo.ThresholdBlackQuantumOp, job.thresholds[n] )
            image.quantumOperator( ch.RedChannel, qo.ThresholdBlackQuantumOp, job.thresholds[n] )
        else:
            # The remaining channels are treated as gray
            image.quantumOperator( ch.GrayChannel, qo.ThresholdBlackQuantumOp, job.thresholds[n] )

        # Make the image brighter according to intensity
        image.modulate( job.intensities[n], 100.0, 100.0 )

        # Write modulated and color modified image to output image
        composite.composite( image, 0, 0, co.PlusCompositeOp )
        composite.magick( image.magick() )

    # Encode image
    composite_blob = Blob()
    composite.write( composite_blob )

    # Let the image expire in one hour
    expire_time = datetime.datetime.utcnow() + datetime.timedelta(minutes=60)
    expire_time = expire_time.strftime('Expires %a, %d %b %Y %H:%M:%S GMT')

    # Return the actual file content
    response = HttpResponse( composite_blob.data )
    response['Content-Type'] = 'image/' + stack.file_extension
    response['Content-Disposition'] = 'attachment; filename="' + str(job.intensities[0]) + img_url  + '"'
    response['Expires'] = expire_time
    response['Connection'] = 'close'

    return response
