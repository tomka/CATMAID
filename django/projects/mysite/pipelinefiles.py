# In this module all the static files are specified that are required by the
# CATMAID front-end. The configuration is separated in libraries and CATMAID's
# own files:
#
# Libraries: To add a new library, add a new entry into the libraries_js
# dictionary and, if needed, add the libraries CSS files to sourcefiles
# tuple of the 'library' entry in the PIPELINE_CSS dictionary.
#
# CATMAID files: By default all CSS files in the static/css directory are
# included as well as all JavaScript files in static/js and CATMAID's
# subdirectories in it. However, if you want to add new files explicitly, add
# CSS to the source_filenames tuple in the 'catmaid' entry of the PIPELINE_CSS
# dictionary. JavaScript files go into the 'catmaid' entry of the PIPELINE_JS
# dictonary at the end of this file.

from collections import OrderedDict

PIPELINE_CSS = {
    'libraries': {
        'source_filenames': (
            'libs/jquery/themes/smoothness/jquery-ui.css',
            'libs/jquery/datatable/css/demo_table.css',
            'libs/jquery/datatable/extras/ColReorder/css/dataTables.colReorder.css',
            'libs/jquery/jquery.growl.css',
            'libs/jquery/jquery-ui.combobox.css',
            'libs/jsTree/classic/style.css',
        ),
        'output_filename': 'css/libraries.css',
        'extra_context': {
            'media': 'screen,projection',
        }
    },
    'catmaid': {
        'source_filenames': (
            'css/*.css',
        ),
        'output_filename': 'css/catmaid.css',
        'extra_context': {
            'media': 'screen,projection',
        }
    },
}

libraries_js = {
    'modernizr': ['*.js'],
    'jquery': ['jquery-2.1.3.min.js', 'jquery-migrate-1.2.1.js',
               'jquery-ui.min.js', 'jquery-ui.*.js',
               'jquery.dataTables.min.js', 'jquery.*.js',
               'dataTables.colReorder.js'],
    'colorpicker': ['colors.js', 'jqColorPicker.js'],
    #'colorpicker': ['colors.js', 'colorPicker.data.js', 'colorPicker.js',
    #                'jqColor.js'],
    'fabric.js': ['all.modified.js'],
    'raphael': ['raphael.js', 'g.raphael.js', 'g.pie-min.js', 'g.line.altered.js',
                'raphael-custom.js', 'colorwheel.js', 'raphael.export.js'],
    'd3': ['d3.v3.js', 'venn.js', 'mds.js', 'colorbrewer.js'],
    'sylvester': ['sylvester.js'],
    'numeric': ['numeric-1.2.6.js'],
    'three.js': ['three.js', 'controls/TrackballControls.js',
                 'camera/CombinedCamera.js', 'Detector.js',
                 'helvetiker_regular.typeface.js',
                 'renderer/Projector.js', 'renderer/SVGRenderer.js'],
    'threex': ['*.js'],
    'pixi.js': ['*.js'],
    'cytoscapejs': ['cytoscape.js'],
    'jsnetworkx': ['*.js'],
    'filesaver': ['*.js'],
    'whammy': ['whammy.js'],
    'catmaid': ['request.js', 'CATMAID.js', 'error.js', 'events.js',
                'neuron_controller.js', 'skeleton_source.js', '*.js'],
}

PIPELINE_JS = OrderedDict()

for k,v in libraries_js.iteritems():
    PIPELINE_JS[k + '-lib'] = {
        'source_filenames': ['libs/%s/%s' % (k,f) for f in v],
        'output_filename': 'js/libs/%s-lib.js' % k,
    }

PIPELINE_JS['arbor'] = {
    'source_filenames': ('libs/cytoscapejs/arbor.js',),
    'output_filename': 'libs/cytoscapejs/arbor.js'
}

PIPELINE_JS['catmaid'] = {
    'source_filenames': (
        'js/CATMAID.js',
        'js/extensions.js',
        'js/action.js',
        'js/init.js',
        'js/navigator.js',
        'js/network-api.js',
        'js/overview.js',
        'js/project.js',
        'js/segmentationtool.js',
        'js/selector.js',
        'js/stack.js',
        'js/stack-viewer.js',
        'js/tilelayercontrol.js',
        'js/tilelayer.js',
        'js/tilesource.js',
        'js/tools.js',
        'js/treelines.js',
        'js/ui.js',
        'js/user.js',
        'js/webglapp.js',
        'js/WindowMaker.js',
        'js/tools/boxselectiontool.js',
        'js/tools/roitool.js',
        'js/tools/*.js',
        'js/layers/pixi-layer.js',
        'js/layers/*.js',
        'js/widgets/*.js',
    ),
    'output_filename': 'js/catmaid.js',
}

