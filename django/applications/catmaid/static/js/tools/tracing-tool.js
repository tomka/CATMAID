/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

  /**
   * Constructor for the tracing tool.
   */
  function TracingTool() {
    this.prototype = new CATMAID.Navigator();
    this.toolname = "tracingtool";

    var self = this;
    // Currently focused tracing layer
    var activeTracingLayer = null;
    // Currently focused stack viewer
    var activeStackViewer = null;
    // Map stacks to its mouse handlers
    var bindings = new Map();

    /**
     * Set postAction option of a command to update of the active tracing layer,
     * if it is available.
     *
     * @returns input command
     */
    var withPostUpdate = function(command) {
      if (activeTracingLayer) {
        var overlay = activeTracingLayer.tracingOverlay;
        command.postAction = overlay.updateNodes.bind(overlay, undefined, undefined, undefined);
      }
      return command;
    };

    this.resize = function(width, height) {
      self.prototype.resize( width, height );
      return;
    };

    this.deselectActiveNode = function() {
      activeTracingLayer.tracingOverlay.activateNode(null);
    };

    var setupSubTools = function() {
      var box;
      if ( self.prototype.stackViewer === null ) {
        box = CATMAID.createButtonsFromActions(
          actions,
          "tracingbuttons",
          "trace_");
        $( "#toolbar_nav" ).prepend( box );

      }
    };

    /**
     * Return a list of all tracing layers, optionally excluding the active one.
     */
    var getTracingLayers = function(excludeActive) {
      var viewers = project.getStackViewers();
      if (excludeActive) {
        viewers = viewers.filter(function(sv) {
          // Exclude active stack viewer
          return activeStackViewer !== sv;
        });
      }

      return viewers.map(function(sv) {
        // Get tracing layer for this stack view, or undefined
        return sv.getLayer(getTracingLayerName(sv));
      }).filter(function(layer) {
        // Ignore falsy layers (which come from stacks
        // that don't have tracing layers.
        return layer ? true : false;
      });
    };

    var setTracingLayersSuspended = function(value, excludeActive) {
      value = Boolean(value);
      getTracingLayers(excludeActive).forEach(function(layer) {
        layer.tracingOverlay.suspended = value;
      });
    };

    var updateNodesInTracingLayers = function(excludeActive) {
      getTracingLayers(excludeActive).forEach(function(layer) {
        layer.tracingOverlay.updateNodes();
      });
    };

    /**
     * Return a unique name for the tracing layer of a given stack viewer.
     */
    var getTracingLayerName = function(stackViewer) {
      return "TracingLayer" + stackViewer.getId();
    };

    var disableLayerUpdate = function() {
      CATMAID.warn("Temporary disabling node update until panning is over");
      activeTracingLayer.tracingOverlay.suspended = true;
    };

    /**
     * Create new mouse bindings for the layer's view.
     */
    function createMouseBindings(stackViewer, layer, mouseCatcher) {
      // A handle to a delayed update
      var updateTimeout;

      var proto_onmousedown = mouseCatcher.onmousedown;
      var stackViewerBindings = {
        onmousedown: function( e ) {
          switch ( CATMAID.ui.getMouseButton( e ) ) {
            case 1:
              layer.tracingOverlay.whenclicked( e );
              break;
            case 2:
              // Put all tracing layers, except active, in "don't update" mode
              setTracingLayersSuspended(true, true);

              // Attach to the node limit hit event to disable node updates
              // temporary if the limit was hit. This allows for smoother panning
              // when many nodes are visible.
              layer.tracingOverlay.on(layer.tracingOverlay.EVENT_HIT_NODE_DISPLAY_LIMIT,
                  disableLayerUpdate, layer);
              // Cancel any existing update timeout, if there is one
              if (updateTimeout) {
                clearTimeout(updateTimeout);
                updateTimeout = undefined;
              }

              // Handle mouse event
              proto_onmousedown( e );

              CATMAID.ui.registerEvent( "onmousemove", updateStatusBar );
              CATMAID.ui.registerEvent( "onmouseup",
                function onmouseup (e) {
                  CATMAID.ui.releaseEvents();
                  CATMAID.ui.removeEvent( "onmousemove", updateStatusBar );
                  CATMAID.ui.removeEvent( "onmouseup", onmouseup );
                  layer.tracingOverlay.off(layer.tracingOverlay.EVENT_HIT_NODE_DISPLAY_LIMIT,
                      disableLayerUpdate, layer);
                  if (layer.tracingOverlay.suspended) {
                    // Wait a second before updating the view, just in case the user
                    // continues to pan to not hit the node limit again. Then make
                    // sure the next update is not stopped.
                    updateTimeout = setTimeout(function() {
                      // Wake tracing overlays up again
                      setTracingLayersSuspended(false, false);
                      // Recreate nodes by fetching them from the database for the new
                      // field of view, don't exclude active layer.
                      updateNodesInTracingLayers(false);
                    }, 1000);
                  } else {
                    // Wake tracing overlays up again
                    setTracingLayersSuspended(false, false);
                    // Recreate nodes by fetching them from the database for the new
                    // field of view. The active layer can be excluded, it should be
                    // updated through the move already.
                    updateNodesInTracingLayers(true);
                  }
                });
              break;
            default:
              proto_onmousedown( e );
              break;
          }
        }
      };

      // Assign bindings to view
      var view = layer.tracingOverlay.view;
      for (var fn in stackViewerBindings) {
        view[fn] = stackViewerBindings[fn];
      }

      bindings.set(stackViewer, stackViewerBindings);
    }

    /**
     * Add the neuron name display and the tracing layer to the given stack
     * viewer, if they don't exist already.
     */
    function prepareStackViewer(stackViewer) {
      var layerName = getTracingLayerName(stackViewer);
      var layer = stackViewer.getLayer(layerName);

      if (!layer) {
        layer = new CATMAID.TracingLayer(stackViewer, {
          show_labels: CATMAID.TracingTool.Settings.session.show_node_labels
        });
        stackViewer.addLayer(layerName, layer);
      }

      // Insert a text div for the neuron name in the canvas window title bar
      var neuronNameDisplayID = "neuronName" + stackViewer.getId();
      var neuronNameDisplay = document.getElementById(neuronNameDisplayID);
      if (!neuronNameDisplay) {
        var stackFrame = stackViewer.getWindow().getFrame();
        neuronnameDisplay = document.createElement("p");
        neuronnameDisplay.id = neuronNameDisplayID;
        neuronnameDisplay.className = "neuronname";
        var spanName = document.createElement("span");
        spanName.appendChild(document.createTextNode(""));
        neuronnameDisplay.appendChild(spanName);
        stackFrame.appendChild(neuronnameDisplay);
        setNeuronNameInTopbars(SkeletonAnnotations.getActiveSkeletonId());
      }

      return layer;
    }

    /**
     * Remove the neuron name display and the tacing layer from a stack view.
     */
    function closeStackViewer(stackViewer) {
      // Unregister the neuron name label from the neuron name service and
      // remove it.
      var label = $('#neuronName' + stackViewer.getId());
      var labelData = label.data();
      if (labelData) CATMAID.NeuronNameService.getInstance().unregister(labelData);
      label.remove();

      // Remove the tracing layer
      var layerName = getTracingLayerName(stackViewer);
      var layer = stackViewer.getLayer(layerName);
      if (layer) {
        // Remove layer from stack viewer. This will also unregister it and
        // destroy the tracing overlay.
        stackViewer.removeLayer(layerName);
      }
    }

    /**
     * install this tool in a stack viewer.
     * register all GUI control elements and event handlers
     */
    this.register = function( parentStackViewer ) {
      document.getElementById( "toolbox_data" ).style.display = "block";

      setupSubTools();

      // Update annotation cache for the current project
      CATMAID.annotations.update();

      // Get or create the tracing layer for this stack viewer
      var layer = prepareStackViewer(parentStackViewer);

      // Set this layer as mouse catcher in Navigator
      var view = layer.tracingOverlay.view;
      self.prototype.setMouseCatcher(view);

      // Register stack viewer with prototype, after the mouse catcher has been set.
      // This attaches mouse handlers to the view.
      self.prototype.register(parentStackViewer, "edit_button_trace");

      document.getElementById( "trace_button_togglelabels" ).className =
          CATMAID.TracingTool.Settings.session.show_node_labels ? "button_active" : "button";

      // Try to get existing mouse bindings for this layer
      if (!bindings.has(parentStackViewer)) createMouseBindings(parentStackViewer, layer, view);

      // Force an update and skeleton tracing mode if stack viewer or layer changed
      if (activeTracingLayer !== layer || activeStackViewer !== parentStackViewer) {
        SkeletonAnnotations.setTracingMode(SkeletonAnnotations.MODES.SKELETON);
        layer.tracingOverlay.updateNodes();
      }

      activeStackViewer = parentStackViewer;
      activeTracingLayer = layer;
      activateBindings(parentStackViewer);
    };

    /**
     * Remove bindings for the given stack viewer from the prototype mouse
     * catcher. The bindings are stored in the bindings variable that is
     * available in the closure.
     */
    var inactivateBindings = function(stackViewer) {
      var handlers = bindings.get(stackViewer);
      var c = self.prototype.mouseCatcher;
      for (var fn in handlers) {
        if (c[fn]) delete c[fn];
      }
    };

    /**
     * Replace bindings of the mouse catcher with the stored bindings for the
     * given stack viewer.
     */
    var activateBindings = function(stackViewer) {
      var stackViewerBindings = bindings.get(stackViewer);
      var c = self.prototype.mouseCatcher;
      for (var b in stackViewerBindings) {
        if (stackViewerBindings.hasOwnProperty(b)) {
          c[b] = stackViewerBindings[b];
        }
      }
    };

    /**
     * unregister all stack viewer related mouse and keyboard controls
     */
    this.unregister = function() {
      // do it before calling the prototype destroy that sets stack viewer to null
      if (self.prototype.stackViewer) {
        inactivateBindings(self.prototype.stackViewer);
      }
      // Do NOT unregister: would remove the mouseCatcher layer
      // and the annotations would disappear
      //self.prototype.unregister();
      return;
    };

    /**
     * unregister all project related GUI control connections and event
     * handlers, toggle off tool activity signals (like buttons)
     */
    this.destroy = function() {
      project.off(CATMAID.Project.EVENT_STACKVIEW_ADDED, prepareStackViewer, this);
      project.off(CATMAID.Project.EVENT_STACKVIEW_CLOSED, closeStackViewer, this);
      SkeletonAnnotations.off(SkeletonAnnotations.EVENT_ACTIVE_NODE_CHANGED,
          handleActiveNodeChange, this);

      project.getStackViewers().forEach(function(stackViewer) {
        closeStackViewer(stackViewer);
      });

      self.prototype.destroy( "edit_button_trace" );
      $( "#tracingbuttons" ).remove();

      // Remove all stored bindings
      bindings.forEach(function(value, key, map) {
        map.delete(key);
      });

      // Forget the current stack viewer
      self.activeStackViewer = null;

      return;
    };

    /**
     * Clear the small bar next to the close button of the stack viewer window,
     * optionally with a replacement text.
     */
    function clearTopbars(text) {
      project.getStackViewers().forEach(function(stackViewer) {
        var label = $('#neuronName' + stackViewer.getId());
        label.text(text || '');
        var labelData = label.data();
        if (labelData) CATMAID.NeuronNameService.getInstance().unregister(labelData);
      });
    }

    /**
     * Set the text in the small bar next to the close button of each stack
     * viewer to the name of the skeleton as it is given by the nameservice.
     */
    function setNeuronNameInTopbars(skeletonID, prefix) {
      if (!skeletonID) {
        clearTopbars();
        return;
      }

      // Make sure we can refer to at least an empty prefix
      prefix = prefix || '';

      project.getStackViewers().forEach(function(stackViewer) {
        var label = $('#neuronName' + stackViewer.getId());
        if (0 === label.length) return;

        CATMAID.NeuronNameService.getInstance().unregister(label.data());

        label.data('skeleton_id', skeletonID);
        label.data('updateNeuronNames', function () {
          label.text(prefix + CATMAID.NeuronNameService.getInstance().getName(this.skeleton_id));
        });

        var models = {};
        models[skeletonID] = {};
        CATMAID.NeuronNameService.getInstance().registerAll(label.data(), models)
          .then(function() {
            label.text(prefix + CATMAID.NeuronNameService.getInstance().getName(skeletonID));
          });
      });
    }

    /**
     * Handle update of active node. All nodes are recolored and the neuron name in
     * the top bar is updated.
     */
    function handleActiveNodeChange(node, skeletonChanged) {
      if (node && node.id) {
        if (skeletonChanged && SkeletonAnnotations.TYPE_NODE === node.type) {
          setNeuronNameInTopbars(node.skeleton_id);
        } else if (SkeletonAnnotations.TYPE_CONNECTORNODE === node.type) {
          if (CATMAID.Connectors.SUBTYPE_SYNAPTIC_CONNECTOR === node.subtype) {
            // Retrieve presynaptic skeleton
            CATMAID.fetch(project.id + "/connector/skeletons", "POST", {
              connector_ids: [node.id]
            })
            .then(function(json) {
              var presynaptic_to = json[0] ? json[0][1].presynaptic_to : false;
              if (presynaptic_to) {
                setNeuronNameInTopbars(presynaptic_to, 'Connector ' + node.id +
                    ', presynaptic partner: ');
              } else {
                clearTopbars('Connector ' + node.id + ' (no presynatpic partner)');
              }
            })
            .catch(CATMAID.handleError);
          } else if (CATMAID.Connectors.SUBTYPE_GAPJUNCTION_CONNECTOR === node.subtype) {
            clearTopbars('Gap junction connector #' + node.id);
          } else {
            clearTopbars('Abutting connector #' + node.id);
          }
        }
      } else {
        clearTopbars();
      }
    }

    this.prototype.changeSlice = function(val) {
      activeStackViewer.moveToPixel( val, activeStackViewer.y, activeStackViewer.x, activeStackViewer.s )
        .catch(CATMAID.warn);
    };


    var updateStatusBar = function(e) {
      var m = CATMAID.ui.getMouse(e, activeTracingLayer.tracingOverlay.view, true);
      var offX, offY, pos_x, pos_y;
      if (m) {
        offX = m.offsetX;
        offY = m.offsetY;

        // TODO pos_x and pos_y never change
        var stackViewer = activeStackViewer;
        // TODO pos_x and pos_y never change
        pos_x = stackViewer.primaryStack.translation.x + (stackViewer.x + (offX - stackViewer.viewWidth  / 2) / stackViewer.scale) * stackViewer.primaryStack.resolution.x;
        pos_y = stackViewer.primaryStack.translation.x + (stackViewer.y + (offY - stackViewer.viewHeight / 2) / stackViewer.scale) * stackViewer.primaryStack.resolution.y;
        CATMAID.statusBar.replaceLast("[" + pos_x.toFixed(3) + ", " + pos_y.toFixed(3) + "]" + " stack x,y: " + stackViewer.x + ", " + stackViewer.y);
      }
      return true;
    };


    /**
     * Add or remove a skeleton projection layer to each view.
     */
    var toggleSkeletonProjectionLayers = function() {
      var key = "skeletonprojection";
      var allHaveLayers = project.getStackViewers().every(function(sv) {
        return !!sv.getLayer(key);
      });

      function add(sv) {
        if (sv.getLayer(key)) return;
        // Add new layer, defaulting to the active skelton source for input
        sv.addLayer(key, new CATMAID.SkeletonProjectionLayer(sv));
      }
      function remove(sv) {
        if (!sv.getLayer(key)) return;
        sv.removeLayer(key);
        sv.redraw();
      }

      var fn = allHaveLayers ? remove : add;
      project.getStackViewers().forEach(fn);
    };


    /**
     * ACTIONS
     *
     **/

    // get basic Actions from Navigator
    var actions = self.prototype.getActions();

    this.getActions = function () {
      return actions;
    };

    this.addAction = function (action) {
      actions.push( action );
    };

    this.addAction(new CATMAID.Action({
      helpText: "Switch to or toggle skeleton tracing mode",
      buttonName: "skeleton",
      buttonID: 'trace_button_skeleton',
      run: function (e) {
        SkeletonAnnotations.setTracingMode(SkeletonAnnotations.MODES.SKELETON, true);
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Switch to or toggle synapse dropping mode",
      buttonName: "synapse",
      buttonID: 'trace_button_synapse',
      run: function (e) {
        if (!CATMAID.mayEdit())
          return false;
        SkeletonAnnotations.setTracingMode(SkeletonAnnotations.MODES.SYNAPSE, true);
        return true;
      }
    }));

    /** Return a function that attempts to tag the active treenode or connector,
     * and display an alert when no node is active.
     */
    var tagFn = function(tag) {
      return function(e) {
        if (!CATMAID.mayEdit()) return false;
        if (e.altKey || e.ctrlKey || e.metaKey) return false;
        var modifier = e.shiftKey;
        var nodeId = SkeletonAnnotations.getActiveNodeId();
        if (null === nodeId) {
          alert('Must activate a treenode or connector before '
              + (modifier ? 'removing the tag' : 'tagging with') + ' "' + tag + '"!');
          return true;
        }

        // If any modifier key is pressed, remove the tag
        if (modifier) {
          SkeletonAnnotations.Tag.removeATNLabel(tag, activeTracingLayer.tracingOverlay);
        } else {
          SkeletonAnnotations.Tag.tagATNwithLabel(tag, activeTracingLayer.tracingOverlay, false);
        }
        return true;
      };
    };

    this.addAction(new CATMAID.Action({
      helpText: "Add 'ends' tag (<kbd>Shift</kbd>: Remove) for the active node",
      keyShortcuts: { "K": [ 75 ] },
      run: tagFn('ends')
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Add 'uncertain end' tag (<kbd>Shift</kbd>: Remove) for the active node",
      keyShortcuts: { "U": [ 85 ] },
      run: tagFn('uncertain end')
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Add 'uncertain continuation' tag (<kbd>Shift</kbd>: Remove) for the active node",
      keyShortcuts: { "C": [ 67 ] },
      run: tagFn('uncertain continuation')
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Add 'not a branch' tag (<kbd>Shift</kbd>: Remove) for the active node",
      keyShortcuts: { "N": [ 78 ] },
      run: tagFn('not a branch')
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Add 'soma' tag (<kbd>Shift</kbd>: Remove) for the active node",
      keyShortcuts: { "M": [ 77 ] },
      run: tagFn('soma')
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Go to active node (<kbd>Shift</kbd>: refresh active skeleton in 3D viewer)",
      buttonName: "goactive",
      buttonID: 'trace_button_goactive',
      keyShortcuts: { "A": [ 65 ] },
      run: function (e) {
        if (!CATMAID.mayView())
          return false;
        if (e.shiftKey) {
          var skid = SkeletonAnnotations.getActiveSkeletonId();
          if (Number.isInteger(skid)) CATMAID.WebGLApplication.prototype.staticReloadSkeletons([skid]);
        } else {
          activeTracingLayer.tracingOverlay.moveToAndSelectNode(SkeletonAnnotations.getActiveNodeId());
        }
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Go to nearest open leaf node (subsequent <kbd>Shift</kbd>+<kbd>R</kbd>: cycle through other open leaves; with <kbd>Alt</kbd>: most recent rather than nearest)",
      keyShortcuts: { "R": [ 82 ] },
      run: function (e) {
        if (!CATMAID.mayView())
          return false;
        activeTracingLayer.tracingOverlay.goToNextOpenEndNode(SkeletonAnnotations.getActiveNodeId(), e.shiftKey, e.altKey);
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Go to next branch or end point (with <kbd>Alt</kbd>: stop earlier at node with tag, synapse or low confidence; subsequent <kbd>Shift</kbd>+<kbd>V</kbd>: cycle through other branches)",
      keyShortcuts: { "V": [ 86 ] },
      run: function (e) {
        if (!CATMAID.mayView())
          return false;
        activeTracingLayer.tracingOverlay.goToNextBranchOrEndNode(SkeletonAnnotations.getActiveNodeId(), e);
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Go to previous branch or end node (with <kbd>Alt</kbd>: stop earlier at node with tag, synapse or low confidence)",
      keyShortcuts: { "B": [ 66 ] },
      run: function (e) {
        if (!CATMAID.mayView())
          return false;
        activeTracingLayer.tracingOverlay.goToPreviousBranchOrRootNode(SkeletonAnnotations.getActiveNodeId(), e);
        return true;
      }
    }));


    this.addAction(new CATMAID.Action({
      helpText: "Deselect the active node",
      keyShortcuts: { "D": [ 68 ] },
      run: function (e) {
        if (!CATMAID.mayView())
          return false;
        activeTracingLayer.tracingOverlay.activateNode(null);
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Go to the parent of the active node (<kbd>Ctrl</kbd>: ignore virtual nodes)",
      keyShortcuts: { "[": [ 219, 56 ] },
      run: (function() {
        var updateInProgress = false;
        return function (e) {
          if (updateInProgress) {
            return false;
          }
          if (!CATMAID.mayView()) {
            return false;
          }

          var modifierKey = e.ctrlKey || e.metaKey;
          if (CATMAID.TracingTool.Settings.session.invert_virtual_node_ignore_modifier) modifierKey = !modifierKey;
          updateInProgress = true;
          var fn = activeTracingLayer.tracingOverlay.goToParentNode.bind(activeTracingLayer.tracingOverlay,
              SkeletonAnnotations.getActiveNodeId(), modifierKey);
          var update = activeTracingLayer.withHiddenUpdate(true, fn);

          // Only allow further parent selections if the last one has been
          // completed.
          update.then(function() {
            updateInProgress = false;
          }).catch(function() {
            updateInProgress = false;
          });

          return true;
        };
      })()
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Go to the child of the active node (<kbd>Ctrl</kbd>: ignore virtual nodes; Subsequent <kbd>Shift</kbd>+<kbd>]</kbd>: cycle through children)",
      keyShortcuts: { "]": [ 221, 57 ] },
      run: (function() {
        var updateInProgress = false;
        return function (e) {
          if (updateInProgress) {
            return false;
          }
          if (!CATMAID.mayView()) {
            return false;
          }

          var modifierKey = e.ctrlKey || e.metaKey;
          if (CATMAID.TracingTool.Settings.session.invert_virtual_node_ignore_modifier) modifierKey = !modifierKey;
          updateInProgress = true;
          var fn = activeTracingLayer.tracingOverlay.goToChildNode.bind(activeTracingLayer.tracingOverlay,
              SkeletonAnnotations.getActiveNodeId(), e.shiftKey, modifierKey);
          var update = activeTracingLayer.withHiddenUpdate(true, fn);

          // Only allow further parent selections if the last one has been
          // completed.
          update.then(function() {
            updateInProgress = false;
          }).catch(function() {
            updateInProgress = false;
          });

          return true;
        };
      })()
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Edit the radius of the active node (<kbd>Shift</kbd>: without measurment tool; <kbd>Ctrl</kbd>: without confirmation dialog)",
      keyShortcuts: { "O": [ 79 ] },
      run: function (e) {
        if (!CATMAID.mayView())
          return false;
        activeTracingLayer.tracingOverlay.editRadius(SkeletonAnnotations.getActiveNodeId(),
            e.shiftKey, false, e.ctrlKey);
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Measure the distance between the cursor and a clicked point",
      keyShortcuts: { "X": [ 88 ] },
      run: function (e) {
        if (!CATMAID.mayView())
          return false;
        activeTracingLayer.tracingOverlay.measureRadius();
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Go to last node edited by you in this skeleton (<kbd>Shift</kbd>: in any skeleton)",
      keyShortcuts: { "H": [ 72 ] },
      run: function (e) {
        if (!CATMAID.mayView())
          return false;
        activeTracingLayer.tracingOverlay.goToLastEditedNode(
          e.shiftKey ? undefined : SkeletonAnnotations.getActiveSkeletonId());
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Append the active skeleton to the last used selection widget " +
          "(<kbd>Ctrl</kbd>: remove from selection; " +
          "<kbd>Shift</kbd>: select by radius; " +
          "<kbd>Alt</kbd>: create a new selection widget)",
      keyShortcuts: {
        "Y": [ 89 ]
      },
      run: function (e) {
        if (e.shiftKey) { // Select skeletons by radius.
          var selectionCallback = (e.ctrlKey || e.metaKey) ?
              function (skids) { CATMAID.SelectionTable.getLastFocused().removeSkeletons(skids); } :
              (e.altKey ?
                  function (skids) { WindowMaker.create('selection-table').widget.addSkeletons(skids); } :
                  function (skids) { CATMAID.SelectionTable.getLastFocused().addSkeletons(skids); });
          var atnID = SkeletonAnnotations.getActiveNodeId();

          activeTracingLayer.tracingOverlay.selectRadius(
              atnID,
              true,
              function (radius) {
                if (typeof radius === 'undefined') return;

                var respectVirtualNodes = true;
                var node = activeTracingLayer.tracingOverlay.nodes[atnID];
                var selectedIDs = activeTracingLayer.tracingOverlay.findAllNodesWithinRadius(
                    activeStackViewer.primaryStack.stackToProjectX(node.z, node.y, node.x),
                    activeStackViewer.primaryStack.stackToProjectY(node.z, node.y, node.x),
                    activeStackViewer.primaryStack.stackToProjectZ(node.z, node.y, node.x),
                    radius, respectVirtualNodes, true);
                selectedIDs = selectedIDs.map(function (nodeID) {
                    return activeTracingLayer.tracingOverlay.nodes[nodeID].skeleton_id;
                }).filter(function (s) { return !isNaN(s); });

                selectionCallback(selectedIDs);
              });
        } else { // Select active skeleton.
          if (e.ctrlKey || e.metaKey) {
            CATMAID.SelectionTable.getLastFocused().removeSkeletons([
                SkeletonAnnotations.getActiveSkeletonId()]);
          } else {
            var selectionTable = e.altKey ?
                WindowMaker.create('selection-table').widget :
                CATMAID.SelectionTable.getLastFocused();
            selectionTable.append(SkeletonAnnotations.activeSkeleton.getSelectedSkeletonModels());
          }
        }
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Split this skeleton at the active node",
      buttonName: "skelsplitting",
      buttonID: 'trace_button_skelsplitting',
      run: function (e) {
        if (!CATMAID.mayEdit())
          return false;
        activeTracingLayer.tracingOverlay.splitSkeleton(SkeletonAnnotations.getActiveNodeId());
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Re-root this skeleton at the active node",
      buttonName: "skelrerooting",
      buttonID: 'trace_button_skelrerooting',
      keyShortcuts: { "6": [ 54 ] },
      run: function (e) {
        if (!CATMAID.mayEdit())
          return false;
        activeTracingLayer.tracingOverlay.rerootSkeleton(SkeletonAnnotations.getActiveNodeId());
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Toggle the display of labels",
      buttonName: "togglelabels",
      buttonID: 'trace_button_togglelabels',
      keyShortcuts: { "7": [ 55 ] },
      run: function (e) {
        if (!CATMAID.mayView())
          return false;

        var settings = CATMAID.TracingTool.Settings;
        var showLabels = !settings.session.show_node_labels;
        settings.set('show_node_labels', showLabels, 'session');
        getTracingLayers().forEach(function(layer) {
          if (showLabels) layer.tracingOverlay.showLabels();
          else layer.tracingOverlay.hideLabels();
        });

        document.getElementById( "trace_button_togglelabels" ).className =
            showLabels ? "button_active" : "button";

        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Switch between a terminal and its connector",
      keyShortcuts: { "S": [ 83 ] },
      run: function (e) {
        if (!CATMAID.mayView())
          return false;
        activeTracingLayer.tracingOverlay.switchBetweenTerminalAndConnector();
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Tag the active node (<kbd>Shift</kbd>: Remove all tags; <kbd>Alt</kbd>: Tag with personal tag set)",
      keyShortcuts: { "T": [ 84 ] },
      run: function (e) {
        if (!CATMAID.mayEdit())
          return false;
        if (e.shiftKey) {
          // Delete all tags
          SkeletonAnnotations.Tag.tagATNwithLabel('', activeTracingLayer.tracingOverlay, true);
          return true;
        } else if (!e.ctrlKey && !e.metaKey) {
          if (e.altKey) {
            var tags = SkeletonAnnotations.Settings.session.personal_tag_set;
            if (tags && tags.length > 0) {
              SkeletonAnnotations.Tag.tagATNwithLabel(tags,
                  activeTracingLayer.tracingOverlay, true);
            } else {
              CATMAID.msg("No tags", "No tags in personal tag set");
            }
          } else {
            SkeletonAnnotations.Tag.tagATN(activeTracingLayer.tracingOverlay);
          }
          return true;
        } else {
          return false;
        }
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Add TODO Tag (<kbd>Shift</kbd>: Remove) to the active node",
      keyShortcuts: { "L": [ 76 ] },
      run: tagFn('TODO')
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Add 'microtubules end' tag (<kbd>Shift</kbd>: Remove) to the active node",
      keyShortcuts: {
        "F": [ 70 ]
      },
      run: tagFn('microtubules end')
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Select the nearest node to the mouse cursor",
      keyShortcuts: { "G": [ 71 ] },
      run: function (e) {
        if (!CATMAID.mayView())
          return false;
        if (!(e.ctrlKey || e.metaKey)) {
          // Give all layers a chance to activate a node
          var selectedNode = null;
          var layers = activeStackViewer.getLayers();
          var layerOrder = activeStackViewer.getLayerOrder();
          // TODO: Don't use internal objects of the tracing overlay, i.e. find
          // a better way to get the current mouse position.
          var x = activeTracingLayer.tracingOverlay.coords.lastX;
          var y = activeTracingLayer.tracingOverlay.coords.lastY;
          // Only allow nodes that are screen space 50px or closer
          var r = 100.0 / activeStackViewer.scale;
          for (var i = layerOrder.length - 1; i >= 0; --i) {
            // Read layers from top to bottom
            var l = layers.get(layerOrder[i]);
            if (CATMAID.tools.isFn(l.getClosestNode)) {
              var candidateNode = l.getClosestNode(x, y, r);
              if (candidateNode && (!selectedNode || candidateNode.distsq < selectedNode.distsq)) {
                selectedNode = candidateNode;
              }
            }
          }
          if (selectedNode) {
            // If this layer has a node close by, activate it
            if (activeTracingLayer.stackViewer.z === selectedNode.node.z) {
              SkeletonAnnotations.staticSelectNode(selectedNode.id);
            } else {
              SkeletonAnnotations.staticMoveToAndSelectNode(selectedNode.id);
            }
          }
          return true;
        } else {
          return false;
        }
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Create treenode (<kbd>Shift</kbd> on another node: join), behavior like mouse click",
      keyShortcuts: { 'Z': [ 90 ] },
      run: function (e) {
        if (!CATMAID.mayEdit())
          return false;
        var insert = e.altKey;
        var link = e.shiftKey;
        var postLink = e.altKey;
        activeTracingLayer.tracingOverlay.createNewOrExtendActiveSkeleton(insert, link, postLink);
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Delete the active node (or suppress it if it is virtual)",
      keyShortcuts: { 'DEL': [ 46 ] },
      run: function (e) {
        if (!CATMAID.mayEdit())
          return false;
        activeTracingLayer.tracingOverlay.deleteNode(SkeletonAnnotations.getActiveNodeId());
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Retrieve information about the active node.",
      keyShortcuts: { 'I': [ 73 ] },
      run: function (e) {
        if (!CATMAID.mayView())
          return false;
        activeTracingLayer.tracingOverlay.printTreenodeInfo(SkeletonAnnotations.getActiveNodeId());
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Set confidence in node link to 1 (Alt: with a connector)",
      keyShortcuts: { '1': [ 49 ] },
      run: function (e) {
        if (!CATMAID.mayEdit())
          return false;
        activeTracingLayer.tracingOverlay.setConfidence(1, e.altKey);
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Set confidence in node link to 2 (Alt: with a connector)",
      keyShortcuts: { '2': [ 50 ] },
      run: function (e) {
        if (!CATMAID.mayEdit())
          return false;
        activeTracingLayer.tracingOverlay.setConfidence(2, e.altKey);
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Set confidence in node link to 3 (Alt: with a connector)",
      keyShortcuts: { '3': [ 51 ] },
      run: function (e) {
        if (!CATMAID.mayEdit())
          return false;
        activeTracingLayer.tracingOverlay.setConfidence(3, e.altKey);
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Set confidence in node link to 4 (Alt: with a connector)",
      keyShortcuts: { '4': [ 52 ] },
      run: function (e) {
        if (!CATMAID.mayEdit())
          return false;
        activeTracingLayer.tracingOverlay.setConfidence(4, e.altKey);
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Set confidence in node link to 5 (Alt: with a connector)",
      keyShortcuts: { '5': [ 53 ] },
      run: function (e) {
        if (!CATMAID.mayEdit())
          return false;
        activeTracingLayer.tracingOverlay.setConfidence(5, e.altKey);
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Move to previous node in segment for review. At an end node, moves one section beyond for you to check that it really ends.",
      keyShortcuts: { 'Q': [ 81 ] },
      run: function (e) {
        if (!CATMAID.mayEdit())
          return false;
        var reviewWidget = CATMAID.ReviewSystem.getLastFocused();
        if (reviewWidget) {
          if (reviewWidget.validSegment()) {
            reviewWidget.moveNodeInSegmentBackward();
          }
        }
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Move to next node in segment for review (with <kbd>Shift</kbd>: move to next unreviewed node in the segment)",
      keyShortcuts: { 'W': [ 87 ] },
      run: function (e) {
        if (!CATMAID.mayEdit())
          return false;
        var reviewWidget = CATMAID.ReviewSystem.getLastFocused();
        if (reviewWidget) {
          if (reviewWidget.validSegment()) {
            reviewWidget.moveNodeInSegmentForward(e.shiftKey);
          }
        }
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Start reviewing the next skeleton segment.",
      keyShortcuts: { 'E': [ 69 ] },
      run: function (e) {
        if (!CATMAID.mayEdit())
          return false;
        var reviewWidget = CATMAID.ReviewSystem.getLastFocused();
        if (reviewWidget) {
          if (reviewWidget.validSegment()) {
            reviewWidget.selectNextSegment();
          }
        }
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Rename active neuron",
      keyShortcuts: { 'F2': [ 113 ] },
      run: function (e) {
        if (!CATMAID.mayEdit()) {
          return false;
        }
        activeTracingLayer.tracingOverlay.renameNeuron(SkeletonAnnotations.getActiveSkeletonId());
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Annotate active neuron",
      keyShortcuts: { 'F3': [ 114 ] },
      run: function (e) {
        if (!CATMAID.mayEdit()) {
          return false;
        }
        CATMAID.annotate_neurons_of_skeletons(
            [SkeletonAnnotations.getActiveSkeletonId()]);
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Neuron dendrogram",
      keyShortcuts: {
        'F4': [ 115 ]
      },
      run: function (e) {
        WindowMaker.create('neuron-dendrogram');
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Command history",
      keyShortcuts: {
        'F9': [ 120 ]
      },
      run: function (e) {
        var dialog = new CATMAID.HistoryDialog();
        dialog.show();
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Toggle skeleton projection layer",
      keyShortcuts: {
        'F10': [ 121 ]
      },
      run: function (e) {
        toggleSkeletonProjectionLayers();
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Open the neuron/annotation search widget (with <kbd>Shift</kbd>: activate next selected neuron in search results after active skeleton)",
      keyShortcuts: { '/': [ 191 ] },
      run: function (e) {
        if (e.shiftKey) {
          var nextSkid = CATMAID.NeuronSearch.prototype.getFirstInstance()
              .getNextSkeletonIdAfter(SkeletonAnnotations.getActiveSkeletonId());
          if (nextSkid) {
            CATMAID.TracingTool.goToNearestInNeuronOrSkeleton('skeleton', nextSkid);
          }
        } else {
          WindowMaker.create('neuron-search');
        }
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Find the nearest matching tagged node (<kbd>Ctrl</kbd>: repeat last tag query; Subsequent <kbd>Shift</kbd>+<kbd>\\</kbd>: cycle to next nearest)",
      keyShortcuts: { '\\': [ 220 ] },
      run: function (e) {
        activeTracingLayer.tracingOverlay.goToNearestMatchingTag(e.shiftKey, e.ctrlKey);
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Bookmark the active node or current location",
      keyShortcuts: { ';': [ 186 ] },
      run: function (e) {
          var dialog = new CATMAID.Bookmarks.Dialog(CATMAID.Bookmarks.MODES.MARK);
          dialog.show();
          return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Go to a bookmarked skeleton",
      keyShortcuts: { '\'': [ 222 ] },
      run: function (e) {
          var dialog = new CATMAID.Bookmarks.Dialog(CATMAID.Bookmarks.MODES.SKELETON);
          dialog.show();
          return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Go to a bookmarked node",
      keyShortcuts: { '`': [ 192 ] },
      run: function (e) {
          var dialog = new CATMAID.Bookmarks.Dialog(CATMAID.Bookmarks.MODES.NODE);
          dialog.show();
          return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Toggle display of skeletons in visibility group 1 (<kbd>Shift</kbd>: visibility group 2)",
      keyShortcuts: { 'HOME': [ 36 ] },
      run: function (e) {
        if (e.shiftKey) {
          SkeletonAnnotations.VisibilityGroups.toggle(SkeletonAnnotations.VisibilityGroups.GROUP_IDS.GROUP_2);
        } else {
          SkeletonAnnotations.VisibilityGroups.toggle(SkeletonAnnotations.VisibilityGroups.GROUP_IDS.GROUP_1);
        }
        return true;
      }
    }));

    this.addAction(new CATMAID.Action({
      helpText: "Peek: show the active skeleton in all open 3D viewers (while held)",
      keyShortcuts: { 'P': [ 80 ] },
      run: function (e) {
        if (self.peekingSkeleton) return;
        var skid = SkeletonAnnotations.getActiveSkeletonId();
        if (skid === null) return;
        self.peekingSkeleton = skid;
        var skeletonModels = {};
        skeletonModels[skid] = new CATMAID.SkeletonModel(
            skid,
            undefined,
            new THREE.Color(SkeletonAnnotations.TracingOverlay.Settings.session.active_node_color));
        var viewersWithoutSkel = Array.from(WindowMaker.getOpenWindows('3d-webgl-view', true).values())
            .filter(function (viewer) { return !viewer.hasSkeleton(skid); });

        var removePeekingSkeleton = function () {
          viewersWithoutSkel.forEach(function (viewer) {
            viewer.removeSkeletons([skid]);
          });
          self.peekingSkeleton = false;
        };

        viewersWithoutSkel.forEach(function (viewer) {
          // In case the key is released before the skeleton has loaded,
          // check after loading whether it is still being peeked.
          viewer.addSkeletons(skeletonModels, function () {
            if (self.peekingSkeleton !== skid) removePeekingSkeleton();
          });
        });

        // Set a key up a listener to remove the skeleton from these viewers
        // when the key is released.
        var target = e.target;
        var oldListener = target.onkeyup;
        target.onkeyup = function (e) {
          if (e.keyCode == 80) {
            target.onkeyup = oldListener;
            removePeekingSkeleton();
          } else if (oldListener) oldListener(e);
        };

        return true;
      }
    }));


    var keyCodeToAction = CATMAID.getKeyCodeToActionMap(actions);

    /**
     * This function should return true if there was any action linked to the key
     * code, or false otherwise.
     */
    this.handleKeyPress = function(e) {
      var keyAction = keyCodeToAction[e.keyCode];
      if (keyAction) {
        activeTracingLayer.tracingOverlay.ensureFocused();
        return keyAction.run(e);
      } else {
        return false;
      }
    };

    this.getUndoHelp = function(e) {
      var result = '<p>The following actions can be undone by pressing <kbd>Ctrl</kbd> + <kbd>Z</kbd> or opening the command history:</p><ul>';
      result += "<li>Add/insert/move/remove nodes and edit their radius, confidence</li>";
      result += "<li>Add/remove connectors, edit their confidence as well as links to/from them</li>";
      result += "<li>Add/remove/edit annotations, tags</li>";
      result += "<li>Change neuron name</li>";
      result += "</ul>";
      return result;
    };

    this.getMouseHelp = function(e) {
      var result = self.prototype.getMouseHelp();
      result += '<ul>';
      result += '<li><strong>Click on a node:</strong> make that node active</li>';
      result += '<li><strong><kbd>Ctrl</kbd>+click in space:</strong> deselect the active node</li>';
      result += '<li><strong><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+click on a node:</strong> delete that node</li>';
      result += '<li><strong><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+click on an arrow:</strong> delete that link</li>';
      result += '<li><strong><kbd>Shift</kbd>+click in space:</strong> create a synapse with the active treenode being presynaptic.</li>';
      result += '<li><strong><kbd>Shift</kbd>+<kbd>Alt</kbd>+click in space:</strong> create a synapse with the active treenode as postsynaptic.</li>';
      result += '<li><strong><kbd>Shift</kbd>+click in space:</strong> create a post-synaptic node (if there was an active connector)</li>';
      result += '<li><strong><kbd>Shift</kbd>+click on a treenode:</strong> join two skeletons (if there was an active treenode)</li>';
      result += '<li><strong><kbd>Alt</kbd>+<kbd>Ctrl</kbd>+click in space:</strong> adds a node along the nearest edge of the active skeleton</li>';
      result += '</ul>';
      return result;
    };

    this.redraw = function() {
      self.prototype.redraw();
    };

    this.init = function() {
      // Make sure all required initial data is available.
      return  CATMAID.fetch(project.id + '/tracing/setup/validate')
        .then(function() {
          // Initialize a tracing layer in all available stack viewers, but let
          // register() take care of bindings.
          project.getStackViewers().forEach(function(s) {
            var layer = prepareStackViewer(s);
            layer.tracingOverlay.updateNodes(layer.forceRedraw.bind(layer));
            // s.getView().appendChild(layer.tracingOverlay.view);
          }, this);
        });
    };

    // Listen to creation and removal of new stack views in current project.
    project.on(CATMAID.Project.EVENT_STACKVIEW_ADDED, prepareStackViewer, this);
    project.on(CATMAID.Project.EVENT_STACKVIEW_CLOSED, closeStackViewer, this);

    // Listen to active node change events
    SkeletonAnnotations.on(SkeletonAnnotations.EVENT_ACTIVE_NODE_CHANGED,
        handleActiveNodeChange, this);
  }

  /**
   * Move to and select a node in the specified neuron or skeleton nearest
   * the current project position.
   *
   * @param  {string} type       A 'neuron' or a 'skeleton'.
   * @param  {number} objectID   The ID of a neuron or a skeleton.
   * @return {Promise}           A promise succeeding after the move and select.
   */
  TracingTool.goToNearestInNeuronOrSkeleton = function(type, objectID) {
    var projectCoordinates = project.focusedStackViewer.projectCoordinates();
    var parameters = {
      x: projectCoordinates.x,
      y: projectCoordinates.y,
      z: projectCoordinates.z
    };
    parameters[type + '_id'] = objectID;
    return CATMAID.fetch(project.id + "/node/nearest", "POST", parameters)
        .then(function (data) {
          var nodeIDToSelect = data.treenode_id;
          // var skeletonIDToSelect = data.skeleton_id; // Unused, but available.
          return SkeletonAnnotations.staticMoveTo(data.z, data.y, data.x)
              .then(function () {
                return SkeletonAnnotations.staticSelectNode(nodeIDToSelect);
              });
        })
        .catch(function () {
          CATMAID.warn('Going to ' + type + ' ' + objectID + ' failed. ' +
                       'The ' + type + ' may no longer exist.');
        });
  };

  TracingTool.search = function() {
    if( $('#search-box').val() === '' ) {
      return;
    }

    var setSearchingMessage = function(message) {
      $('#search-results').empty();
      $('#search-results').append($('<i/>').text(message));
    };

    setSearchingMessage('Search in progress...');
    requestQueue.register(django_url + project.id + '/search', "GET", {
      pid: project.id,
      substring: $('#search-box').val()
    }, function (status, text) {
      var i, table, tbody, row, actionLink, data;
      if (status !== 200) {
        setSearchingMessage('Search failed with HTTP status'+status);
      } else {
        data = JSON.parse(text);
        if (null === data) {
          setSearchingMessage('Search failed, parseJSON returned null. Check javascript console.');
          return;
        }
        if (data.error) {
          setSearchingMessage('Search failed with error: '+data.error);
        } else {
          $('#search-results').empty();
          $('#search-results').append($('<i/>').data('Found '+data.length+' results:'));
          table = $('<table/>');
          $('#search-results').append(table);
          tbody = $('<tbody/>');
          tbody.append('<tr><th></th><th>ID</th><th>Name</th><th>Class</th><th>Action</th><th></th></tr>');
          table.append(tbody);
          var action = function(type) {
            return function() {
                TracingTool.goToNearestInNeuronOrSkeleton(type, parseInt($(this).attr('id')));
                return false;
            };
          };
          var actionaddstage = function(type) {
            return function() {
              // Find an open Selection, or open one if none
              var selection = CATMAID.SelectionTable.prototype.getOrCreate();
              selection.addSkeletons([parseInt($(this).attr('id'))]);
              return false;
            };
          };
          var removelabel = function(id) {
            return function() {
              CATMAID.fetch(project.id + '/label/remove', "POST", {
                label_id: id
              })
              .then(function(json) {
                CATMAID.msg('Success', 'Label removed');
              })
              .catch(CATMAID.handleError);
            };
          };
          for (i = 0; i < data.length; ++i) {
            row = $('<tr/>');
            row.append($('<td/>').text(i+1));
            row.append($('<td/>').text(data[i].id));
            row.append($('<td/>').text(data[i].name));
            row.append($('<td/>').text(data[i].class_name));
            if (data[i].class_name === 'neuron' || data[i].class_name === 'skeleton') {
              var tdd = $('<td/>');
              actionLink = $('<a/>');
              actionLink.attr({'id': ''+data[i].id});
              actionLink.attr({'href':''});
              actionLink.click(action(data[i].class_name));
              actionLink.text("Go to nearest node");
              tdd.append(actionLink);
              if( data[i].class_name === 'skeleton' ) {
                actionLink = $('<a/>');
                actionLink.attr({'id': ''+data[i].id});
                actionLink.attr({'href':''});
                actionLink.click(actionaddstage(data[i].class_name));
                actionLink.text(" Add to selection table");
                tdd.append(actionLink);
              }
              row.append(tdd);
            } else if (data[i].class_name === 'label') {
              // Create a link that will then query, when clicked, for the list of nodes
              // that point to the label, and show a list [1], [2], [3] ... clickable,
              // or better, insert a table below this row with x,y,z,parent skeleton, parent neuron.
              if (data[i].hasOwnProperty('nodes')) {
                var td = $('<td/>');
                row.append(td);
                data[i].nodes.reduce(function(index, node) {
                  // Local copies
                  var z = parseInt(node.z);
                  var y = parseInt(node.y);
                  var x = parseInt(node.x);
                  var id = parseInt(node.id);
                  var skid = parseInt(node.skid);
                  td.append(
                    $('<a/>').attr({'id': '' + id})
                             .attr({'href':''})
                             .click(function(event) {
                               SkeletonAnnotations.staticMoveTo(z, y, x)
                                  .then(function() {
                                    SkeletonAnnotations.staticSelectNode(id, skid);
                                  });
                               return false;
                             })
                             .text("[" + index + "]")
                    ).append("&nbsp;");
                  if( index % 20 === 0)
                    td.append('<br />');
                  return index + 1;
                }, 1);
              } else {
                // no nodes, option to remove the label
                actionLink = $('<a/>');
                actionLink.attr({'id': ''+data[i].id});
                actionLink.attr({'href': '#'});
                actionLink.click(removelabel(data[i].id));
                actionLink.text("Remove label");
                row.append($('<td/>').append(actionLink));
              }
            } else {
              row.append($('<td/>').text('IMPLEMENT ME'));
            }
            row.append($('<td/>').text(i+1));
            tbody.append(row);
          }
        }
      }
      return true;
    });


  };

  /**
   * Actions available for the tracing tool.
   */
  TracingTool.actions = [

    new CATMAID.Action({
      helpText: "Review Widget: Review existing skeletons",
      buttonID: "data_button_review",
      buttonName: 'table_review',
      run: function (e) {
        WindowMaker.show('review-system');
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "Notifications: Accept or reject action requests by other users",
      buttonID: "data_button_notifications",
      buttonName: 'table_notifications',
      run: function (e) {
        WindowMaker.create('notifications');
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "Connectivity Widget: List all connected partners to one or more skeletons",
      buttonID: "data_button_connectivity",
      buttonName: 'table_connectivity',
      run: function (e) {
        WindowMaker.create('connectivity-widget');
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "Connectivity Matrix: Quantify connections between skeletons",
      buttonID: "data_button_connectivity_matrix",
      buttonName: 'adj_matrix',
      run: function (e) {
        WindowMaker.create('connectivity-matrix');
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "Graph Widget: Work with graph representation of connectivity between skeletons",
      buttonID: "data_button_compartment_graph_widget",
      buttonName: 'graph_widget',
      run: function (e) {
        WindowMaker.create('graph-widget');
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "Circuit Graph Plot",
      buttonID: "data_button_circuit_graph_plot",
      buttonName: 'circuit_plot',
      run: function (e) {
        WindowMaker.create('circuit-graph-plot');
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "Morphology Plot: Plot skeleton properties over distance from root node",
      buttonID: "data_button_morphology_plot",
      buttonName: 'morphology_plot',
      run: function (e) {
        WindowMaker.create('morphology-plot');
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "Tag Table: Find skeletons based on their tags",
      buttonID: "data_button_tag_table",
      buttonName: 'tag-table',
      run: function (e) {
        WindowMaker.create('tag-table');
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "Venn Diagram: Find overlap and difference between sets of skeletons",
      buttonID: "venn_diagram_button",
      buttonName: 'venn',
      run: function (e) {
        WindowMaker.create('venn-diagram');
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "Selection Table: Manage lists of skeletons",
      buttonID: "data_button_neuron_staging_area_widget",
      buttonName: 'neuron_staging',
      run: function (e) {
        WindowMaker.create('selection-table');
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "Global Search: Search on skeleton and neuron properties as well as labels",
      buttonID: "data_button_search",
      buttonName: 'search',
      run: function (e) {
        WindowMaker.show('search');
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "Neuron Navigator: View details and analytics of individual skeletons",
      buttonID: 'data_button_neuron_navigator',
      buttonName: 'neuron_navigator',
      run: function (e) {
        WindowMaker.create('neuron-navigator');
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "Neuron Search: Search for skeletons and annotations based on names, annotations, contributors and timestamps",
      buttonID: "data_button_query_neurons",
      buttonName: 'query_neurons',
      run: function (e) {
        WindowMaker.create('neuron-search');
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "3D Viewer: 3D visualization of selected skeletons",
      buttonID: "view_3d_webgl_button",
      buttonName: '3d-view-webgl',
      run: function (e) {
        WindowMaker.create('3d-webgl-view');
      }
    }),

    new CATMAID.Action({
      helpText: "Project Statistics: Display user contribution statistics",
      buttonID: "data_button_stats",
      buttonName: 'stats',
      run: function (e) {
        WindowMaker.show('statistics');
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "Log Widget: Show record of user activity",
      buttonID: "data_button_table_log",
      buttonName: 'table_log',
      run: function (e) {
        WindowMaker.show( 'log-table' );
        return true;
      }
    }),

    new CATMAID.Action({
      helpText: "Synapse Distribution Plot: Show synapse distribution with partners over distance from root node",
      buttonID: "data_button_synapse_plot",
      buttonName: 'synapse_plot',
      run: function (e) {
        WindowMaker.create('synapse-plot');
        return true;
      }
    }),

  ];

  // Make tracing tool in CATMAID namespace
  CATMAID.TracingTool = TracingTool;

  CATMAID.TracingTool.Settings = new CATMAID.Settings(
      'tracing-tool',
      {
        version: 0,
        entries: {
          invert_virtual_node_ignore_modifier: {
            default: false
          },
          show_node_labels: {
            default: false
          }
        },
        migrations: {}
      });

})(CATMAID);
