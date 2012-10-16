/**
 * proctilelayer.js
 *
 * requirements:
 *   tilelayer.js
 *
 */

/**
 * A tile layer that allows on-the-fly processing of the
 * stack's tiles by calling a manipulation script.
 */
function ProcTileLayer(
        stack,                      //!< reference to the parent stack
        tileWidth,
        tileHeight
        )
{
    // override URL creation function - Python version
    this.getTileURL = function( project, stack, baseName,
        tileWidth, tileHeight, col, row, zoom_level )
    {
        var sids = [];
        var ints = [];
        var thrs = [];
        for (var s in self.adjustable_stacks)
        {
            sids.push( s );
            ints.push( self.adjustable_stacks[ s ].intensity );
            thrs.push( self.adjustable_stacks[ s ].threshold );
        }
        url = django_url + project.id + "/stack/" + sids.join() + "/combine_tiles/"
            + stack.z + "/" + col + "/" + row + "/" + zoom_level + "/"
            + thrs.join() + "/" + ints.join() + "/";
        return url;
    };

    this.getOverviewLayer = function( layer )
    {
        return new DummyOverviewLayer();
    }

    // sets the threshold of stack with id s to val
    this.setThreshold = function( s, val )
    {
        val = val.toFixed( 0 );
        // set the threshold
        self.adjustable_stacks[ s ].threshold = val;
        // display some status information
        var title = self.adjustable_stacks[ s ].data.title;
        statusBar.replaceLast( "Setting threshold of stack \"" + title  + "\" to " + val );
        // update the screen
        self.redraw();
    };

    // sets the intensity of stack with id s to val
    this.setIntensity = function( s, val )
    {
        // set the intensity
        self.adjustable_stacks[ s ].intensity = val;
        // display some status information
        var title = self.adjustable_stacks[ s ].data.title;
        var percent = val.toFixed( 0 );
        statusBar.replaceLast( "Setting intensity of stack \"" + title  + "\" to " + percent + "%" );
        // update the screen
        self.redraw();
    };

    // call super constructor and add self as tile source
    TileLayer.call(this, stack, tileWidth, tileHeight, this);

    // initialization

    var self = this;

    var view = document.createElement( "div" );
    view.className = "IntensityLayer";
    view.id = "IntensityLayer";
    view.style.zIndex = 6;

    // create an offset and an adjustment slider for
    // each stack available
    var project = stack.getProject();
    var stacks = projects_available[project.id];
    self.adjustable_stacks = new Array();
    for ( var s in stacks )
    {
        // slider for threshold values
        var threshold_container = document.createElement("div");
        var default_threshold = 0;
        var threshold_handler = function( val )
        {
            self.setThreshold( this.stackid, val );
        };
        var threshold_slider = new Slider(
                        SLIDER_HORIZONTAL,
                        false,
                        0,
                        255,
                        256,
                        default_threshold,
                        threshold_handler );

        threshold_slider.setByValue( default_threshold, true );
        threshold_slider.stackid = s;
        threshold_container.className = "IntensityBox";
        threshold_container.innerHTML += "Threshold of " + stacks[s].title + "<br />";
        threshold_container.appendChild( threshold_slider.getView() );
        view.appendChild( threshold_container );

        // slider for intensity values
        var intensity_container = document.createElement("div");
        var default_intensity = 100;
        var intensity_handler = function( val )
        {
            self.setIntensity( this.stackid, val );
        };
        var intensity_slider = new Slider(
                        SLIDER_HORIZONTAL,
                        false,
                        0,
                        1000,
                        31,
                        default_intensity,
                        intensity_handler );

        intensity_slider.setByValue( default_intensity, true );
        intensity_slider.stackid = s;
        intensity_container.className = "IntensityBox";
        intensity_container.innerHTML += "Intensity of " + stacks[s].title + "<br />";
        intensity_container.appendChild( intensity_slider.getView() );
        view.appendChild( intensity_container );

        // fill stack data structure
        self.adjustable_stacks[ s ] = {
            threshold : default_threshold,
            intensity : default_intensity,
            data : stacks[s],
            intensity_slider : intensity_slider,
            threshold_slider : threshold_slider
        }
    };

    stack.getView().appendChild( view );

    return this;
}
extend( ProcTileLayer, TileLayer );

