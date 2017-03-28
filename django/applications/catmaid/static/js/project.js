/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

/**
 * project.js
 *
 * requirements:
 *   tools.js
 *   request.js
 *
 */

(function(CATMAID) {

  "use strict";

  /**
   * A CATMAID project.
   *
   * - contains abstract objects on top of a common project-specific semantic framework
   * - is related to one ore more stacks of statically aligned layers
   *   ( all stacks of a project are related by translation using physical dimensions )
   *
   * @class
   * @param {number} pid  API ID of this CATMAID project.
   */
  function Project( pid ) {

    this.getView = function() {
      return view;
    };

    /**
     * Add a stack viewer to the project.
     *
     * @param {StackViewer} stackViewer Viewer to add to the project and UI.
     */
    this.addStackViewer = function( stackViewer ) {
      // Save a local reference to the currently focused stack, because it gets
      // overwritten if the new stack is added.
      var lastFocusedStackViewer = self.focusedStackViewer;

      stackViewers.push( stackViewer );

      var inTree = false;
      var node = stackViewer.getWindow();

      while (!inTree && node !== null) {
        node = node.getParent();
        inTree = node instanceof CMWRootNode;
      }

      if (!inTree) {
        var rootWindow = CATMAID.rootWindow;

        if ( rootWindow.getChild() === null ) {
          rootWindow.replaceChild( stackViewer.getWindow() );
        } else {
          rootWindow.replaceChild( new CMWHSplitNode( rootWindow.getChild(),
            stackViewer.getWindow() ) );
        }
      }

      stackViewer.getWindow().focus();
      CATMAID.ui.onresize();

      if ( stackViewers.length > 1 ) {
        self.moveToProject( self.coordinates.z, self.coordinates.y, self.coordinates.x,
            lastFocusedStackViewer.primaryStack.stackToProjectSX( lastFocusedStackViewer.s ));
      } else {
        var c = stackViewer.projectCoordinates();
        self.moveTo( c.z, c.y, c.x );
      }

      self.setFocusedStackViewer( stackViewer );

      // only set the tool for the first stack viewer
      if ( stackViewers.length == 1 ) {
        if ( !tool )
          tool = new CATMAID.Navigator();
        self.setTool( tool );
      }

      // Announce that a new stack view was added
      this.trigger(Project.EVENT_STACKVIEW_ADDED, stackViewer);
    };

    /**
     * Get one of the projects currently opened stack viewers.
     */
    this.getStackViewer = function (id) {
      for ( var i = 0; i < stackViewers.length; ++i ) {
        if ( stackViewers[ i ].getId() === id ) return stackViewers[ i ];
      }
      return false;
    };

    /**
     * Get all currently opened stack viewers.
     *
     * @return {StackViewer[]}
     */
    this.getStackViewers = function() {
      return stackViewers;
    };

    /**
     * Get all stack viewers whose primary stack has a given ID.
     * @param  {number} stackId  ID of the primary stack to search for.
     * @return {StackViewer[]}
     */
    this.getViewersForStack = function (stackId) {
      return stackViewers.filter(function (stackViewer) {
        return stackViewer.primaryStack.id === stackId;
      });
    };

    /**
     * Remove a stack viewer from the list.
     */
    this.removeStackViewer = function (id) {
      for ( var i = 0; i < stackViewers.length; ++i )
      {
        if ( stackViewers[ i ].getId() === id )
        {
          var removedViews = stackViewers.splice( i, 1 );

          // Announce that this stack view was closed. Do this before
          // potentially destroying the project.
          this.trigger(Project.EVENT_STACKVIEW_CLOSED, removedViews[0]);

          if ( stackViewers.length === 0 )
            self.destroy();
          else
            stackViewers[ ( i + 1 ) % stackViewers.length ].getWindow().focus();
        }
      }
      CATMAID.ui.onresize();
    };

    /**
     * focus a stack and blur the rest
     */
    this.setFocusedStackViewer = function( stackViewer ) {
      self.focusedStackViewer = stackViewer;
      if ( tool )
        self.focusedStackViewer.setTool( tool );
      window.onresize();
      this.trigger(Project.EVENT_STACKVIEW_FOCUS_CHANGED, stackViewer);
    };

    /**
     * focus the next or prior stack
     */
    this.switchFocus = function( s ) {
      var i;
      for ( i = 0; i < stackViewers.length; ++i )
        if ( self.focusedStackViewer == stackViewers[ i ] ) break;

      stackViewers[ ( i + stackViewers.length + s ) % stackViewers.length ].getWindow().focus();
    };

    //!< Associative array of selected objects
    // in the Treenode Table and Object Tree.
    // I.e. enables communication between the Object Tree and the Table of Nodes.
    this.selectedObjects = {
      'tree_object': {},
      'table_treenode': {},
      'selectedneuron': null,
      'selectedskeleton': null,
          'selectedassembly': null
    };

    this.setSelectObject = function( type, id ) {
        this.selectedObjects.selectedneuron = null;
        this.selectedObjects.selectedskeleton = null;
        this.selectedObjects.selectedassembly = null;
        if( type == "neuron" ) {
            this.selectedObjects.selectedneuron = id;
        } else if( type == "skeleton" ) {
            this.selectedObjects.selectedskeleton = id;
        } else if( type == "assembly" ) {
            this.selectedObjects.selectedassembly = id;
        }
        // if the segmentation tool is select, we need to update
        // the assembly id
        if( self.getTool().toolname === 'segmentationtool' ) {
            SegmentationAnnotations.set_current_assembly_id( this.selectedObjects.selectedassembly );
        }

    };

    this.hideToolbars = function() {
      document.getElementById( "toolbar_nav" ).style.display = "none";
      document.getElementById( "toolbar_text" ).style.display = "none";
      document.getElementById( "toolbar_trace" ).style.display = "none";
    };

    this.hideToolboxes = function() {
      document.getElementById( "toolbox_segmentation" ).style.display = "none";
      document.getElementById( "toolbox_data" ).style.display = "none";
    };

    this.setTool = function( newTool ) {
      // Destroy the old project only, if it isn't the very same project that gets
      // set again.
      if( tool && newTool !== tool )
        tool.destroy();
      tool = newTool;

      self.hideToolboxes();

      var prepare;
      if (CATMAID.tools.isFn(newTool.init)) {
        prepare = newTool.init();
      } else {
        prepare = Promise.resolve();
      }

      prepare
        .then(function() {
          if ( !self.focusedStackViewer && stackViewers.length > 0 ) {
            self.setFocusedStackViewer( stackViewers[ 0 ] );
          }

          self.focusedStackViewer.setTool( tool );

          if ( self.focusedStackViewer ) {
            if (!self.focusedStackViewer.getWindow().hasFocus())
              self.focusedStackViewer.getWindow().focus();
          }
          window.onresize();
          WindowMaker.setKeyShortcuts();
        })
        .catch(CATMAID.handleError);
    };

    this.getTool = function( ) {
      return tool;
    };

    this.toggleShow = function( m ) {
      switch ( m )
      {
      case "text":
        if ( show_textlabels && mode != "text" )
        {
          show_textlabels = false;
          document.getElementById( "show_button_text" ).className = "button";
          for ( var i = 0; i < stackViewers.length; ++i )
            stackViewers[ i ].showTextlabels( false );
        }
        else
        {
          show_textlabels = true;
          for ( var i = 0; i < stackViewers.length; ++i )
            stackViewers[ i ].showTextlabels( true );
          document.getElementById( "show_button_text" ).className = "button_active";
        }
      }
    };

    /**
     * register all GUI elements
     */
    this.register = function() {
      document.getElementById("toolbox_edit").style.display = "block";
      document.getElementById( "content" ).style.display = "none";
      document.body.appendChild( view );
    };

    /**
     * unregister and remove all stacks, free the event-handlers, hide the stack-toolbar
     *
     * @todo: should not the stack handle the navigation toolbar?
     */
    this.destroy = function() {
      if ( tool ) tool.destroy();

      //! Close all windows. There is no need to explicitely call close()
      //! on the root window as this done by the last child.
      CATMAID.rootWindow.closeAllChildren();

      try
      {
        document.body.removeChild( view );
      }
      catch ( error ) {}
      self.id = 0;
      document.getElementById( "content" ).style.display = "block";
      document.getElementById( "stackmenu_box" ).style.display = "none";
      document.getElementById( "stack_menu" ).style.display = "none";
      // TODO: bars should be unset by tool on unregister
      document.getElementById("toolbox_edit").style.display = "none";
      document.getElementById("toolbox_data").style.display = "none";
      document.getElementById("toolbox_segmentation").style.display = "none";
      document.getElementById( "toolbox_project" ).style.display = "none";
      document.getElementById( "toolbar_nav" ).style.display = "none";

      CATMAID.statusBar.replaceLast('');
      CATMAID.statusBar.printCoords('');

      project = null;
    };

    /**
     * Indicate if the project location can be changed. Stack viewers
     * can block location change requests (e.g. to not interrupt user
     * input).
     */
    this.canMove = function() {
      return stackViewers.every(function(sv) {
        return sv.navigateWithProject ? sv.canMove() : true;
      });
    };

    /**
     * move all stacks to the physical coordinates, except sp, sp is a
     * stack specific scale level that cannot be traced back to where it
     * came from, so we just pass it through.
           * Rxecute a completion * callback when everything is done.
           * One stack is moved as a continuation
     * of the stack before (except first stack, which is moved directly). This
     * makes sure we also wait for asynchronous requests to finish, that a stack
     * move might imply (e.g. requesting more treenodes for the tracing tool).
     */
    this.moveTo = function(zp, yp, xp, sp, completionCallback) {
      if (!this.canMove()) {
        return Promise.resolve("A location change is not possible at this moment");
      }

      self.coordinates.x = xp;
      self.coordinates.y = yp;
      self.coordinates.z = zp;

      var movePromises = stackViewers.map(function (sv) {
        return sv.navigateWithProject ?
          new Promise(function (resolve, reject) {
            sv.moveTo(zp, yp, xp, sp, resolve);
          }) :
          Promise.resolve();
      });

      return Promise.all(movePromises).then(function () {
        if (tool && tool.redraw)
          tool.redraw();
        self.trigger(Project.EVENT_LOCATION_CHANGED, self.coordinates.x,
          self.coordinates.y, self.coordinates.z);
        if (typeof completionCallback !== "undefined") {
          completionCallback();
        }
      });
    };

    /**
     * move all stacks to the physical coordinates, at a given resolution
     * in units per pixels
     */
    this.moveToProject = function(zp, yp, xp, res, completionCallback) {
      if (!this.canMove()) {
        return Promise.reject("A location change is not possible at this moment");
      }

      self.coordinates.x = xp;
      self.coordinates.y = yp;
      self.coordinates.z = zp;

      var movePromises = stackViewers.map(function (sv) {
        return sv.navigateWithProject ?
          new Promise(function (resolve, reject) {
            sv.moveToProject(zp, yp, xp, res, resolve);
          }) :
          Promise.resolve();
      });

      return Promise.all(movePromises).then(function () {
        if (tool && tool.redraw)
          tool.redraw();
        self.trigger(Project.EVENT_LOCATION_CHANGED, self.coordinates.x,
          self.coordinates.y, self.coordinates.z);
        if (typeof completionCallback !== "undefined") {
          completionCallback();
        }
      });
    };

    this.updateTool = function() {
      if ( tool && tool.updateLayer )
        tool.updateLayer();
    };

    // Need to add this "tool-specific" function
    // to project because need to call it from the
    // object tree widget
    this.deselectActiveNode = function() {
      if ( tool && tool.deselectActiveNode )
        tool.deselectActiveNode();
    };

    /**
     * create a URL to the current view
     */
    this.createURL = function() {
      var coords;
      var url="?pid=" + self.id;
      if ( stackViewers.length > 0 )
      {
        //coords = stacks[ 0 ].projectCoordinates();    //!< @todo get this from the SELECTED stack to avoid approximation errors!
        url += "&zp=" + self.coordinates.z + "&yp=" + self.coordinates.y +
            "&xp=" + self.coordinates.x;
        url += "&tool=" + project.getTool().toolname;
        if( project.getTool().toolname === 'tracingtool' ) {
          var active_skeleton_id = SkeletonAnnotations.getActiveSkeletonId();
          if( active_skeleton_id ) {
            url += "&active_skeleton_id=" + active_skeleton_id;
            url += "&active_node_id=" + SkeletonAnnotations.getActiveNodeId();
          }
        }
        for ( var i = 0; i < stackViewers.length; ++i )
        {
          url += "&sid" + i + "=" + stackViewers[ i ].primaryStack.id + "&s" + i + "=" + stackViewers[ i ].s;
        }
      }
      return url;
    };

    /** This function should return true if there was any action
      linked to the key code, or false otherwise. */

    this.handleKeyPress = function( e ) {
      var keyAction = keyCodeToAction[e.keyCode];
      if (keyAction) {
        return keyAction.run(e);
      } else {
        return false;
      }
    };

    /**
     * Get project ID.
     */
    this.getId = function(){ return pid; };

    // initialise
    var self = this;
    this.id = pid;
    if ( typeof requestQueue == "undefined" ) requestQueue = new RequestQueue();

    var tool = null;

    var view = CATMAID.rootWindow.getFrame();
    view.className = "projectView";

    this.coordinates = {
      x : 0,
      y : 0,
      z : 0
    };

    var template;       //!< DTD like abstract object tree (classes)
    var data;         //!< instances in a DOM representation

    var stackViewers = [];  //!< a list of stacks related to the project
    this.focusedStackViewer = undefined;

    var mode = "move";
    var show_textlabels = true;

    var icon_text_apply = document.getElementById( "icon_text_apply" );

    /** The only actions that should be added to Project are those
        that should be run regardless of the current tool, such as
        actions that switch tools. */

    var actions = CATMAID.toolActions.concat(CATMAID.EditTool.actions);

    this.getActions = function () {
      return actions;
    };

    var keyCodeToAction = CATMAID.getKeyCodeToActionMap(actions);
  }

  /**
   * Get all visible projects, optionally sorted by name.
   */
  Project.list = function(sort) {
    var projects = CATMAID.fetch('projects/');
    if (sort) {
      projects = projects.then(function(projects) {
        return projects.sort(function(a, b) {
          return CATMAID.tools.compareStrings(a.title, b.title);
        });
      });
    }

    return projects;
  };

  // Add event support to project and define some event constants
  CATMAID.asEventSource(Project.prototype);
  Project.EVENT_STACKVIEW_ADDED = 'project_stackview_added';
  Project.EVENT_STACKVIEW_CLOSED = 'project_stackview_closed';
  Project.EVENT_STACKVIEW_FOCUS_CHANGED = 'project_stackview_focus_changed';
  Project.EVENT_LOCATION_CHANGED = 'project_location_changed';

  // Make Project available in CATMAID namespace
  CATMAID.Project = Project;

})(CATMAID);
