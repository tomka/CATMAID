/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */
/* global
  CATMAID,
  display_tracing_setup_dialog,
  Events,
  mayEdit,
  NeuronAnnotations,
  NeuronNameService,
  OverlayLabel,
  project,
  requestQueue,
  SelectionTable,
  session,
  SkeletonElements,
  submitterFn,
  user_groups,
  userprofile,
  WebGLApplication
*/

"use strict";

/**
 * Contains the current state of skeleton annotations.
 */
var SkeletonAnnotations = {
  atn_fillcolor : "rgb(0, 255, 0)",

  /**
   * Data of the active Treenode or ConnectorNode. Its position is stored in
   * unscaled stack space coordinates.
   */
  atn : {
    id: null,
    type: null,
    subtype: null,
    skeleton_id: null,
    x: null,
    y: null,
    z: null,
    parent_id: null,
    stack_id: null
  },

  TYPE_NODE : "treenode",
  TYPE_CONNECTORNODE : "connector",

  // Connector nodes can have different subtypes
  SUBTYPE_SYNAPTIC_CONNECTOR : "synaptic-connector",
  SUBTYPE_ABUTTING_CONNECTOR : "abutting-connector",

  sourceView : new CATMAID.ActiveSkeleton(),

  // Event name constants
  EVENT_ACTIVE_NODE_CHANGED: "tracing_active_node_changed",
  EVENT_SKELETON_CHANGED: "tracing_skeleton_changed",
};

SkeletonAnnotations.MODES = Object.freeze({SKELETON: 0, SYNAPSE: 1});
SkeletonAnnotations.currentmode = SkeletonAnnotations.MODES.skeleton;
SkeletonAnnotations.newConnectorType = SkeletonAnnotations.SUBTYPE_SYNAPTIC_CONNECTOR;
SkeletonAnnotations.setRadiusAfterNodeCreation = false;
Events.extend(SkeletonAnnotations);

/**
 * Sets the active node, if node is not null. Otherwise, the active node is
 * cleared. Since the node passed is expected to come in scaled (!) stack space
 * coordinates, its position has to be unscaled.
 */
SkeletonAnnotations.atn.set = function(node, stack_id) {
  var changed = false;

  if (node) {
    // Find out if there was a change
    var stack = project.getStack(stack_id);
    changed = (this.id !== node.id) ||
              (this.skeleton_id !== node.skeleton_id) ||
              (this.type !== node.type) ||
              (this.subtype !== node.subtype) ||
              (this.z !== node.z) ||
              (this.y !== node.y)  ||
              (this.x !== node.x) ||
              (this.parent_id !== node.parent_id) ||
              (this.stack_id !== stack_id);

    // Assign new properties
    this.id = node.id;
    this.skeleton_id = node.skeleton_id;
    this.type = node.type;
    this.subtype = node.subtype;
    this.x = node.x;
    this.y = node.y;
    this.z = node.z;
    this.parent_id = node.parent ? node.parent.id : null;
    this.stack_id = stack_id;
  } else {
    changed = true;
    // Set all to null
    for (var prop in this) {
      if (this.hasOwnProperty(prop)) {
        if (typeof this[prop] === 'function') {
          continue;
        }
        this[prop] = null;
      }
    }
  }

  // Trigger event if node ID or position changed
  if (changed) {
    SkeletonAnnotations.trigger(
          SkeletonAnnotations.EVENT_ACTIVE_NODE_CHANGED, this);
  }
};

/**
 * Creates and returns a new node promise for the active node. If the node had
 * to be created, the active node is updated, before the success function is
 * called.
 */
SkeletonAnnotations.atn.promise = function()
{
  var overlay = SkeletonAnnotations.getSVGOverlay(this.stack_id);
  var nodePromise = overlay.promiseNode(overlay.nodes[this.id]);
  function AtnPromise(atn) {
    // Override prototype's
    this.then = function(fn) {
      nodePromise.then(function(result) {
        // Set ID of active node, expect ID as result
        if (atn.id !== result) {
          atn.id = result;
          SkeletonAnnotations.trigger(
              SkeletonAnnotations.EVENT_ACTIVE_NODE_CHANGED, atn);
        }
        // Call the orginal callback
        if (fn) {
          fn(result);
        }
      });
    };
  }
  AtnPromise.prototype = nodePromise;

  return new AtnPromise(this);
};

/**
 * Map a stack to a displayed overlay.
 */
SkeletonAnnotations.getSVGOverlay = function(stack) {
  return this.SVGOverlay.prototype._instances[stack];
};

/**
 * Map a D3 paper instance to an overlay.
 */
SkeletonAnnotations.getSVGOverlayByPaper = function(paper) {
  var instances = this.SVGOverlay.prototype._instances;
  for (var stackID in instances) {
    if (instances.hasOwnProperty(stackID)) {
      var s = instances[stackID];
      if (paper === s.paper.node()) {
        return s;
      }
    }
  }
  return null;
};

/**
 * Select a node in any of the existing SVGOverlay instances, by its ID.
 * WARNING: Will only select the node in the first SVGOverlay found to contain it.
 */
SkeletonAnnotations.staticSelectNode = function(nodeID) {
  var instances = this.SVGOverlay.prototype._instances;
  for (var stack in instances) {
    if (instances.hasOwnProperty(stack)) {
      return instances[stack].selectNode(nodeID);
    }
  }
  CATMAID.statusBar.replaceLast("Could not find node #" + nodeID);
};

/**
 * Move to a location, ensuring that any edits to node coordinates are pushed
 * to the database. After the move, the fn is invoked.
 */
SkeletonAnnotations.staticMoveTo = function(z, y, x, fn) {
  var instances = SkeletonAnnotations.SVGOverlay.prototype._instances;
  for (var stack in instances) {
    if (instances.hasOwnProperty(stack)) {
      instances[stack].moveTo(z, y, x, fn);
    }
  }
};

/**
 * Move to a location, ensuring that any edits to node coordinates are pushed to
 * the database. After the move, the given node is selected and fn is invoked.
 */
SkeletonAnnotations.staticMoveToAndSelectNode = function(nodeID, fn) {
  var instances = SkeletonAnnotations.SVGOverlay.prototype._instances;
  for (var stack in instances) {
    if (instances.hasOwnProperty(stack)) {
      instances[stack].moveToAndSelectNode(nodeID, fn);
    }
  }
};

/**
 * Get the ID of the active node or null if there is no active node.
 */
SkeletonAnnotations.getActiveNodeId = function() {
  return this.atn.id;
};

/**
 * Get the ID of the active skeleton or null if there is no active skeleton.
 */
SkeletonAnnotations.getActiveSkeletonId = function() {
  return this.atn.skeleton_id;
};

/**
 * Get the type of the active node or null if there is no active node.
 */
SkeletonAnnotations.getActiveNodeType = function() {
  return this.atn.type;
};

SkeletonAnnotations.getActiveNodeSubType = function() {
  return this.atn.subtype;
};

/**
 * Get the fill color for an active node.
 */
SkeletonAnnotations.getActiveNodeColor = function() {
  return this.atn_fillcolor;
};

/**
 * Returns the positon of the active node in unscaled stack space coordinates.
 * If there is no active node, null is returned.
 */
SkeletonAnnotations.getActiveNodePosition = function() {
  if (null === this.atn.id) {
    return null;
  } else {
    return {'x': this.atn.x, 'y': this.atn.y, 'z': this.atn.z};
  }
};

/**
 * Returns the positon of the active node in world coordinates. If there is no
 * active node, null is returned.
 */
SkeletonAnnotations.getActiveNodePositionW = function() {
  if (null === this.atn.id) {
    return null;
  } else {
    var stack = project.getStack(this.atn.stack_id);
    return {'x': stack.stackToProjectX(this.atn.z, this.atn.y, this.atn.x),
            'y': stack.stackToProjectY(this.atn.z, this.atn.y, this.atn.x),
            'z': stack.stackToProjectZ(this.atn.z, this.atn.y, this.atn.x)};
  }
};

/**
 * Get A THREE.Vector3 representation of the active treenode's location.
 */
SkeletonAnnotations.getActiveNodeVector3 = function() {
  return new THREE.Vector3(this.atn.x, this.atn.y, this.atn.z);
};

/**
 * Get the ID of the stack the active node was selected from or null if there is
 * no active node.
 */
SkeletonAnnotations.getActiveStackId = function() {
  return this.atn.stack_id;
};

/**
 * Export the active skeleton as SWC. The data is generated on the server and
 * the client is asked to download it.
 */
SkeletonAnnotations.exportSWC = function() {
  if (!this.atn.id || !this.atn.skeleton_id) {
    alert('Need to activate a treenode before exporting to SWC!');
    return;
  }
  var skeleton_id = this.atn.skeleton_id;

  requestQueue.register(
    django_url + project.id + '/skeleton/' + skeleton_id + '/swc',
    "POST",
    {},
    function (status, text, xml) {
      if (status === 200) {
        var blob = new Blob([text], {type: "text/plain"});
        saveAs(blob, skeleton_id + ".swc");
      }
    });
};

/**
 * Set tracing mode to node or synapse mode. This determines what is created if
 * the user clicks on the canvas.
 */
SkeletonAnnotations.setTracingMode = function (mode) {
  // toggles the button correctly
  // might update the mouse pointer
  document.getElementById("trace_button_skeleton").className = "button";
  document.getElementById("trace_button_synapse").className = "button";

  switch (mode) {
    case this.MODES.SKELETON:
      this.currentmode = mode;
      document.getElementById("trace_button_skeleton").className = "button_active";
      break;
    case this.MODES.SYNAPSE:
      this.currentmode = mode;
      document.getElementById("trace_button_synapse").className = "button_active";
      break;
  }
};

/**
 * Set the text in the small bar next to the close button of a stack to the
 * name of the skeleton as it is given by the nameservice.
 */
SkeletonAnnotations.setNeuronNameInTopbar = function(stackID, skeletonID) {
  if (!skeletonID) return;
  var label = $('#neuronName' + stackID);
  NeuronNameService.getInstance().unregister(label.data());
  label.data('skeleton_id', skeletonID);
  label.data('updateNeuronNames', function () {
    label.text(NeuronNameService.getInstance().getName(this.skeleton_id));
  });
  var models = {};
  models[skeletonID] = {};
  NeuronNameService.getInstance().registerAll(label.data(), models,
    function () { label.text(NeuronNameService.getInstance().getName(skeletonID)); });
};

/**
 * Clear the small bar next to the close button of the stack window.
 */
SkeletonAnnotations.clearTopbar = function(stackID) {
  var label = $('#neuronName' + stackID);
  NeuronNameService.getInstance().unregister(label.data());
  label.text("");
};

/**
 * Get a valid virtual node ID for a node between child, parent at section Z.
 */
SkeletonAnnotations.getVirtualNodeID = function(childID, parentID, z) {
  return 'vn-' + childID + '-' + parentID + '-' + z;
};

/**
 * Return if the given node ID is the ID of a real treenode.
 */
SkeletonAnnotations.isRealNode = function(node_id)
{
  // For now it is enough to test if the given ID *could* be one of a real node,
  // i.e. if it is a number.
  return !isNaN(parseInt(node_id));
};

/**
 * Return RegEx match object for a node ID tested against the virtual node
 * naming scheme.
 */
SkeletonAnnotations.getVirtualNodeComponents = function(nodeID)
{
  // Add an empty string to also be able to work with numbers.
  return (nodeID + '').match(/vn-(\d+)-(\d+)-(\d+)/);
};

/**
 * Return the child component of a virtual node ID. If the node passed in, is
 * real, null is returned.
 */
SkeletonAnnotations.getChildOfVirtualNode = function(nodeID, matches)
{
  matches = matches || SkeletonAnnotations.getVirtualNodeComponents(nodeID);
  if (!matches || matches.length < 3) {
    return null;
  }
  return matches[1];
};

/**
 * Return the child component of a virtual node ID. If the node passed in, is
 * real, null is returned.
 */
SkeletonAnnotations.getParentOfVirtualNode = function(nodeID, matches)
{
  var matches = matches || SkeletonAnnotations.getVirtualNodeComponents(nodeID);
  if (!matches || matches.length < 3) {
    return null;
  }
  return matches[2];
};

/**
 * Return the Z component of a virtual node ID. If the node passed in, is
 * real, null is returned.
 */
SkeletonAnnotations.getZOfVirtualNode = function(nodeID, matches)
{
  var matches = matches || SkeletonAnnotations.getVirtualNodeComponents(nodeID);
  if (!matches || matches.length < 3) {
    return null;
  }
  return matches[3];
};


/**
 * The constructor for SVGOverlay.
 */
SkeletonAnnotations.SVGOverlay = function(stack) {
  this.stack = stack;

  // Register instance
  this.register(stack);

  this.submit = submitterFn();

  /** The ID vs Node or ConnectorNode instance. */
  this.nodes = {};
  /** The DOM elements representing node labels. */
  this.labels = {};
  /** Toggle for text labels on nodes and connectors. */
  this.show_labels = false;
  /** Indicate if this overlay is suspended and won't update nodes on redraw. */
  this.suspended = false;

  /* Variables keeping state for toggling between a terminal and its connector. */
  this.switchingConnectorID = null;
  this.switchingTreenodeID = null;

  /* lastX, lastY: in unscaled stack coordinates, for the 'z' key to know where
   * the mouse was. */
  this.coords = {lastX: null, lastY: null};

  /* padding beyond screen borders for fetching data and updating nodes */
  this.PAD = 256;
 
  /* old_x and old_y record the x and y position of the stack the
     last time that an updateNodes request was made.  When panning
     the stack, these are used to tell whether the user has panned
     far enough to merit issuing another updateNodes. */
  this.old_x = stack.x;
  this.old_y = stack.y;

  this.view = document.createElement("div");
  this.view.className = "sliceSVGOverlay";
  this.view.id = "sliceSVGOverlayId" + stack.getId();
  this.view.style.zIndex = 5;
  // Custom cursor for tracing
  this.view.style.cursor ="url(" + STATIC_URL_JS + "images/svg-circle.cur) 15 15, crosshair";
  this.view.onmousemove = this.createViewMouseMoveFn(this.stack, this.coords);

  this.paper = d3.select(this.view)
                  .append('svg')
                  .attr({
                      width: stack.viewWidth,
                      height: stack.viewHeight,
                      style: 'overflow: hidden; position: relative;'});
// If the equal ratio between stack, SVG viewBox and overlay DIV size is not
// maintained, this additional attribute would be necessary:
// this.paper.attr('preserveAspectRatio', 'xMinYMin meet')
  this.graphics = CATMAID.SkeletonElementsFactory.createSkeletonElements(this.paper, stack.getId());

  // Listen to change and delete events of skeletons
  CATMAID.neuronController.on(CATMAID.neuronController.EVENT_SKELETON_CHANGED,
    this.handleChangedSkeleton, this);
  CATMAID.neuronController.on(CATMAID.neuronController.EVENT_SKELETON_DELETED,
    this.handleDeletedSkeleton, this);
};

SkeletonAnnotations.SVGOverlay.prototype = {
  EVENT_HIT_NODE_DISPLAY_LIMIT: "tracing_hit_node_display_limit"
};
Events.extend(SkeletonAnnotations.SVGOverlay.prototype);

/**
 * Creates the node with the given ID, if it is only a virtual node. Otherwise,
 * it is resolved immediately. A node object as well as number (representing a
 * node ID) can be passed in. If only a number is passed, it is expected that
 * the node is available at the moment of the call in the nodes cache. An error
 * is thrown if this is not the case.
 */
SkeletonAnnotations.SVGOverlay.prototype.promiseNode = function(node)
{
  var self = this;

  return new Promise(function(resolve, reject) {

    // If the node is a string or a number, try to find it in the nodes cache.
    var type = typeof node;
    if ("string" === type || "number" === type) {
      node = self.nodes[node];
    }

    // Raise error, if no node or a node without ID was passed in
    if (!node || !node.id) {
      reject(Error("Please specify a node object or valid node ID"));
      return;
    }

    // If the node can be parsed as a number, it is assumed to be already there.
    if (!isNaN(parseInt(node.id))) {
      resolve(node.id);
      return;
    }

    // If the node ID is a string matching the pattern vn-<number>, it is
    // considered a virtual node with its child ID encoded.
    var matches  = (node.id + '').match(/vn-(\d+)/);
    if (!matches || matches.length < 2) {
      // Raise an error, if this pattern was not matched
      reject(Error("Could not handle node ID: " + node.id));
      return;
    }

    var childId = matches[1];

    // Create new node and update parent relation of child
    requestQueue.register(
      django_url + project.id + '/treenode/create',
      'POST',
      {
        pid: project.id,
        parent_id: node.parent_id,
        x: self.stack.stackToProjectX(node.z, node.y, node.x),
        y: self.stack.stackToProjectY(node.z, node.y, node.x),
        z: self.stack.stackToProjectZ(node.z, node.y, node.x),
        radius: node.radius,
        confidence: node.confidence,
        useneuron: node.useneuron
      },
      CATMAID.jsonResponseHandler(function(result) {
        var nid = result.treenode_id;
        CATMAID.statusBar.replaceLast("Created new node node #" + nid +
            " as child of node #" + childId);
        // Update nodes
        var vnid = node.id;
        self.nodes[nid] = self.nodes[vnid];
        delete self.nodes[vnid];
        // Update node reference, passed in
        node.id = nid;
        // If the virtual node was the active node before, update the active
        // node as well.
        if (SkeletonAnnotations.getActiveNodeId() == vnid) {
          self.activateNode(node);
        }

        // Update child node to refer to new node as parent
        requestQueue.register(
          django_url + project.id + '/treenode/' + childId + '/parent',
          'POST',
          {
            parent_id: nid
          },
          CATMAID.jsonResponseHandler(function (json) {
            self.updateNodes();
            // Resolve promise
            resolve(nid);
          }, function(err) {
            // Reject promise in case of error
            reject(err);
          }));
      }, function(err) {
        // Reject promise in case of error
        reject(err);
      }));
  });
};

/**
 * Creates all given nodes, if they are virtual nodes. Otherwise, it is resolved
 * immediately.
 */
SkeletonAnnotations.SVGOverlay.prototype.promiseNodes = function()
{
  var self = this;
  var args = arguments;
  return new Promise(function(resolve, reject) {
    // Resolve immediately, if there are no nodes passed as argument
    if (0 === args.length) {
      resolve();
    }

    // Build a promise chain to resolve one node after the other
    var nodeIds = [];
    var promiseChain = self.promiseNode(args[0]);

    // Queue a promise for every
    for (var i=1; i<args.length; ++i) {
        var node = args[i];
        promiseChain = promiseChain.then(
          function(promisedNid) {
            // Store result of this promise
            nodeIds.push(promisedNid);
            // Create a new promise for the next node
            return self.promiseNode(node);
          },
          function() {
              // In case of rejection, reject also the multi-node promise
              reject(Error("Could not fullfil promise of node " + node.id));
          });
    }

    // Resolve only if promises for individual nodes resolve
    promiseChain.then(function(promisedNid) {
      // Store result of this promise
      nodeIds.push(promisedNid);
      // Resolve the multi node promise
      resolve(nodeIds);
    });
  });
};

/**
 * Execute function fn_real, if the node identified by node_id is a real node
 * (i.e not a virtual node).
 */
SkeletonAnnotations.SVGOverlay.prototype.executeDependentOnExistence =
    function(node_id, fn_real, fn_notreal)
{
  if (SkeletonAnnotations.isRealNode(node_id) && fn_real) {
    fn_real();
    return true;
  } else if (fn_notreal) {
    fn_notreal();
  }
  return false;
};

/**
* Execute the function fn if the skeleton has more than one node and the dialog
* is confirmed, or has a single node (no dialog pops up).  The verb is the
* action to perform, as written as a question in a dialog to confirm the action
* if the skeleton has a single node.
*/
SkeletonAnnotations.SVGOverlay.prototype.executeDependentOnNodeCount =
    function(node_id, fn_one, fn_more)
{
  this.submit(
      django_url + project.id + '/skeleton/node/' + node_id + '/node_count',
      {},
      function(json) {
        if (json.count > 1) {
          fn_more();
        } else {
          fn_one();
        }
      });
};

/**
 * Execute the function fn if the current user has permissions to edit it.
 */
SkeletonAnnotations.SVGOverlay.prototype.executeIfSkeletonEditable = function(
    skeleton_id, fn) {
  var url = django_url + project.id + '/skeleton/' + skeleton_id +
      '/permissions';
  requestQueue.register(url, 'POST', null,
     CATMAID.jsonResponseHandler(function(permissions) {
        // Check permissions
        if (!permissions.can_edit) {
          new CATMAID.ErrorDialog("This skeleton is locked by another user " +
              "and you are not part of the other user's group. You don't " +
              "have permission to modify it.").show();
          return;
        }
        // Execute continuation
        fn();
     }));
};

/**
 * Ask the user for a new neuron name for the given skeleton and let the name
 * service write it to the skeleton.
 */
SkeletonAnnotations.SVGOverlay.prototype.renameNeuron = function(skeletonID) {
  if (!skeletonID) return;
  var self = this;
  this.submit(
      django_url + project.id + '/skeleton/' + skeletonID + '/neuronname',
      {},
      function(json) {
          var new_name = prompt("Change neuron name", json['neuronname']);
          if (!new_name) return;
          NeuronNameService.getInstance().renameNeuron(
              json['neuronid'], [skeletonID], new_name);
      });
};

/**
 * Register of stackID vs instances.
 */
SkeletonAnnotations.SVGOverlay.prototype._instances = {};

/**
 * Register a new stack with this instance.
 */
SkeletonAnnotations.SVGOverlay.prototype.register = function (stack) {
  this._instances[stack.id] = this;
};

/**
 * Unregister this overlay from all stacks.
 */
SkeletonAnnotations.SVGOverlay.prototype.unregister = function () {
  for (var stack in this._instances) {
    if (this._instances.hasOwnProperty(stack)) {
      if (this === this._instances[stack]) {
        delete this._instances[stack];
      }
    }
  }
};

/**
 * The original list of nodes; beware the instance of the list will change, the
 * contents of any one instance may change, and the data of the nodes will
 * change as they are recycled.
 */
SkeletonAnnotations.SVGOverlay.prototype.getNodes = function() {
  return this.nodes;
};

/**
 * The stack this overlay is registered with.
 */
SkeletonAnnotations.SVGOverlay.prototype.getStack = function() {
  return this.stack;
};

/**
 * Stores the current mouse coordinates in unscaled stack coordinates in the
 * @coords parameter.
 */
SkeletonAnnotations.SVGOverlay.prototype.createViewMouseMoveFn = function(stack, coords) {
  return function(e) {
    var m = CATMAID.ui.getMouse(e, stack.getView(), true);
    if (m) {
      var screenPosition = stack.screenPosition();
      coords.lastX = screenPosition.left + m.offsetX / stack.scale;
      coords.lastY = screenPosition.top  + m.offsetY / stack.scale;
      // This function is called often, so the least memory consuming way should
      // be used to create the status bar update.
      CATMAID.statusBar.printCoords('['+ Math.round(coords.lastX) + ", " +
          Math.round(coords.lastY) + ", " + Math.round(project.coordinates.z) +']');
    }
    return true; // Bubble mousemove events.
  };
};

/**
 * This returns true if focus had to be switched; typically if the focus had to
 * be switched, you should return from any event handling, otherwise all kinds
 * of surprising bugs happen...
 */
SkeletonAnnotations.SVGOverlay.prototype.ensureFocused = function() {
  var win = this.stack.getWindow();
  if (win.hasFocus()) {
    return false;
  } else {
    win.focus();
    return true;
  }
};

/**
 * Unregister this layer and destroy all UI elements and event handlers.
 */
SkeletonAnnotations.SVGOverlay.prototype.destroy = function() {
  this.unregister();
  // Show warning in case of pending request

  this.submit = null;
  // Release
  if (this.graphics) {
    this.graphics.destroy();
    this.graphics = null;
  }
  if (this.view) {
    this.view.onmousemove = null;
    this.view.onmousedown = null;
    this.view = null;
  }

  // Unregister from neuron controller
  CATMAID.neuronController.off(CATMAID.neuronController.EVENT_SKELETON_CHANGED,
      this.handleChangedSkeleton, this);
  CATMAID.neuronController.off(CATMAID.neuronController.EVENT_SKELETON_DELETED,
      this.handleDeletedSkeleton, this);
};

/**
 * Activates the given node id if it exists in the current retrieved set of
 * nodes.
 */
SkeletonAnnotations.SVGOverlay.prototype.selectNode = function(id) {
  var node = this.nodes[id];
  if (node) {
    this.activateNode(node);
  }
};

/**
 * Find connectors pre- and postsynaptic to the given node ID.
 * Returns an array of two arrays, containing IDs of pre and post connectors.
 */
SkeletonAnnotations.SVGOverlay.prototype.findConnectors = function(node_id) {
  var pre = [];
  var post = [];
  for (var id in this.nodes) {
    if (this.nodes.hasOwnProperty(id)) {
      var node = this.nodes[id];
      if (SkeletonAnnotations.SUBTYPE_SYNAPTIC_CONNECTOR === node.subtype) {
        if (node.pregroup.hasOwnProperty(node_id)) {
          pre.push(parseInt(id));
        } else if (node.postgroup.hasOwnProperty(node_id)) {
          post.push(parseInt(id));
        }
      }
    }
  }
  return [pre, post];
};

/**
 * Make sure all currently visible nodes have the correct color.
 */
SkeletonAnnotations.SVGOverlay.prototype.recolorAllNodes = function () {
  // Assumes that atn and active_skeleton_id are correct:
  for (var nodeID in this.nodes) {
    if (this.nodes.hasOwnProperty(nodeID)) {
      this.nodes[nodeID].updateColors();
    }
  }
};

/**
 * Select or deselect (if node is falsy) a node. This involves setting the top
 * bar and the status bar as well as updating SkeletonAnnotations.atn. Can
 * handle virtual nodes.
 */
SkeletonAnnotations.SVGOverlay.prototype.activateNode = function(node) {
  var atn = SkeletonAnnotations.atn,
      last_skeleton_id = atn.skeleton_id;
  if (node) {
    // Check if the node is already selected/activated
    if (node.id === atn.id && node.skeleton_id === atn.skeleton_id) {
      // Update coordinates
      atn.set(node, this.getStack().getId());
      return;
    }
    // Else, select the node
    if (SkeletonAnnotations.TYPE_NODE === node.type) {
      // Update CATMAID.statusBar
      var prefix = SkeletonAnnotations.isRealNode(node.id) ?
          "Node " + node.id + ", skeleton " + node.skeleton_id :
          "Virtual node, skeleton " + node.skeleton_id;
      this.printTreenodeInfo(node.id, prefix);
      SkeletonAnnotations.setNeuronNameInTopbar(this.stack.getId(), node.skeleton_id);
      atn.set(node, this.getStack().getId());
      this.recolorAllNodes();
    } else if (SkeletonAnnotations.TYPE_CONNECTORNODE === node.type) {
      if (SkeletonAnnotations.SUBTYPE_ABUTTING_CONNECTOR === node.subtype) {
        CATMAID.statusBar.replaceLast("Activated abutting connector node #" + node.id);
      } else {
        CATMAID.statusBar.replaceLast("Activated synaptic connector node #" + node.id);
      }
      atn.set(node, this.getStack().getId());
      SkeletonAnnotations.clearTopbar(this.stack.getId());
      this.recolorAllNodes();
    }
  } else {
    // Deselect
    atn.set(null, null);
    project.setSelectObject( null, null );
    this.recolorAllNodes();
    SkeletonAnnotations.clearTopbar(this.stack.getId());
  }

  // (de)highlight in SkeletonSource instances if any if different from the last
  // activated skeleton
  if (last_skeleton_id !== SkeletonAnnotations.getActiveSkeletonId()) {
    CATMAID.skeletonListSources.highlight(SkeletonAnnotations.sourceView,
        SkeletonAnnotations.getActiveSkeletonId());
  }
};

/**
 * Activate the node nearest to the mouse. Optionally, virtual nodes can be
 * respected.
 */
SkeletonAnnotations.SVGOverlay.prototype.activateNearestNode = function (respectVirtualNodes) {

  var nearestnode = this.findNodeWithinRadius(this.coords.lastX,
      this.coords.lastY, Number.MAX_VALUE, respectVirtualNodes);
  if (nearestnode) {
    if (Math.abs(nearestnode.z - this.stack.z) < 0.5) {
      this.activateNode(nearestnode);
    } else {
      CATMAID.statusBar.replaceLast("No nodes were visible in the current " +
          "section - can't activate the nearest");
    }
  }
  return nearestnode;
};

/**
 * Return a method with the signature function(nodes, nodeId) which returns true
 * if @nodes contains a field named @nodeId and is a real node. Optionally,
 * virtual nodes can be respected in this lookup. If this is not requested, the
 * test is not part of the returned function. Otherwise, the returned function
 * returns false.
 */
SkeletonAnnotations.validNodeTest = function(respectVirtualNodes)
{
  if (respectVirtualNodes) {
   return function(nodes, nodeId) {
      return nodes.hasOwnProperty(nodeId);
    };
  } else {
    return function(nodes, nodeId) {
      return nodes.hasOwnProperty(nodeId) &&
        SkeletonAnnotations.isRealNode(nodeId);
    };
  }
};

/**
 * Expects x and y in scaled (!) stack coordinates. Can be asked to respect
 * virtual nodes.
 */
SkeletonAnnotations.SVGOverlay.prototype.findNodeWithinRadius = function (
    x, y, radius, respectVirtualNodes)
{
  var xdiff,
      ydiff,
      distsq,
      mindistsq = radius * radius,
      nearestnode = null,
      node,
      nodeid;

  // Add an virual node check, if wanted
  var nodeIsValid = SkeletonAnnotations.validNodeTest(respectVirtualNodes);

  for (nodeid in this.nodes) {
    if (nodeIsValid(this.nodes, nodeid)) {
      node = this.nodes[nodeid];
      xdiff = x - node.x;
      ydiff = y - node.y;
      // Must discard those not within current z
      if (Math.abs(this.stack.z - node.z) > 0.5) continue;
      distsq = xdiff*xdiff + ydiff*ydiff;
      if (distsq < mindistsq) {
        mindistsq = distsq;
        nearestnode = node;
      }
    }
  }
  return nearestnode;
};

/**
 * Return all node IDs in the overlay within a radius of the given point.
 * Optionally, virtual nodes can be respceted.
 */
SkeletonAnnotations.SVGOverlay.prototype.findAllNodesWithinRadius = function (
    x, y, z, radius, respectVirtualNodes)
{
  var xdiff, ydiff, zdiff, distsq, radiussq = radius * radius, node, nodeid;

  // respect virual nodes, if wanted
  var nodeIsValid = SkeletonAnnotations.validNodeTest(respectVirtualNodes);

  return Object.keys(this.nodes).filter((function (nodeid) {
    if (nodeIsValid(this.nodes, nodeid)) {
      node = this.nodes[nodeid];
      xdiff = x - this.pix2physX(node.z, node.y, node.x);
      ydiff = y - this.pix2physY(node.z, node.y, node.x);
      zdiff = z - this.pix2physZ(node.z, node.y, node.x);
      distsq = xdiff*xdiff + ydiff*ydiff + zdiff*zdiff;
      if (distsq < radiussq)
        return true;
    }

    return false;
  }).bind(this));
};

/**
 * Find the point along the edge from node to node.parent nearest (x, y, z),
 * optionally exluding a radius around the nodes.
 */
SkeletonAnnotations.SVGOverlay.prototype.pointEdgeDistanceSq = function (
    x, y, z, node, exclusion)
{
  var a, b, p, ab, ap, r, ablen;

  exclusion = exclusion || 0;

  a = new THREE.Vector3(this.pix2physX(node.z, node.y, node.x),
                        this.pix2physY(node.z, node.y, node.x),
                        this.pix2physZ(node.z, node.y, node.x));
  b = new THREE.Vector3(this.pix2physX(node.parent.z, node.parent.y, node.parent.x),
                        this.pix2physY(node.parent.z, node.parent.y, node.parent.x),
                        this.pix2physZ(node.parent.z, node.parent.y, node.parent.x));
  p = new THREE.Vector3(x, y, z);
  ab = new THREE.Vector3().subVectors(b, a);
  ablen = ab.lengthSq();
  if (ablen === 0) return {point: a, distsq: p.distanceToSquared(a)};
  ap = new THREE.Vector3().subVectors(p, a);
  r = ab.dot(ap)/ablen;
  exclusion *= exclusion/ablen;

  // If r is not in [0, 1], the point nearest the line through the node and
  // its parent lies beyond the edge between them, so clamp the point to the
  // edge excluding a radius near the nodes.
  if (r < 0) r = exclusion;
  else if (r > 1) r = 1 - exclusion;

  a.lerp(b, r);
  return  {point: a, distsq: p.distanceToSquared(a)};
};

/**
 * Find the point nearest physical coordinates (x, y, z) nearest the specified
 * skeleton, including any nodes in additionalNodes. Virtual nodes can
 * optionally be enabled so that these are respected as well.
 */
SkeletonAnnotations.SVGOverlay.prototype.findNearestSkeletonPoint = function (
    x, y, z, skeleton_id, additionalNodes, respectVirtualNodes)
{
  var nearest = { distsq: Infinity, node: null, point: null };
  var phys_radius = (30.0 / this.stack.scale) *
    Math.max(this.stack.resolution.x, this.stack.resolution.y);

  var self = this;
  // Allow virtual nodes, if wanted
  var nodeIsValid = SkeletonAnnotations.validNodeTest(respectVirtualNodes);

  var nearestReduction = function (nodes, nearest) {
    return Object.keys(nodes).reduce(function (nearest, nodeId) {
      var node = nodes[nodeId];
      if (nodeIsValid(nodes, node.id) &&
          node.skeleton_id === skeleton_id &&
          node.parent !== null)
        {
        var tmp = self.pointEdgeDistanceSq(x, y, z, node, phys_radius);
        if (tmp.distsq < nearest.distsq) return {
          distsq: tmp.distsq,
          node: node,
          point: tmp.point
        };
      }
      return nearest;
    }, nearest);
  };

  nearest = nearestReduction(this.nodes, nearest);
  if (additionalNodes) nearest = nearestReduction(additionalNodes, nearest);
  return nearest;
};

/**
 * Insert a node along the edge in the active skeleton nearest the specified
 * point. Includes the active node (atn), its children, and its parent, even if
 * they are beyond one section away. Can optionally respect virtual nodes.
 */
SkeletonAnnotations.SVGOverlay.prototype.insertNodeInActiveSkeleton = function (
    phys_x, phys_y, phys_z, atn, respectVirtualNodes)
{
  var self = this;

  var insertNode = (function (additionalNodes) {
    var insertion = this.findNearestSkeletonPoint(phys_x, phys_y, phys_z,
        atn.skeleton_id, additionalNodes, respectVirtualNodes);
    if (insertion.node) {

      // Make sure both the insertion node and its parent exist
      this.promiseNodes(insertion.node, insertion.node.parent)
        .then((function(nids) {
          var isection = nids[0];
          var isectionParent = nids[1];
          this.createNode(isectionParent, phys_x, phys_y, phys_z,
            -1, 5, this.phys2pixX(phys_x), this.phys2pixY(phys_y),
            this.phys2pixZ(phys_z), function (self, nn) {
              // Callback after creating the new node to make it the parent of the node
              // it was inserted before
              self.submit(
                django_url + project.id + '/treenode/' + isection + '/parent',
                {parent_id: nn.id},
                function(json) {
                  self.updateNodes();
                });
            });
          }).bind(this));
    }
  }).bind(this);

  atn.promise().then(function(atnId) {
    self.submit(
        django_url + project.id + "/node/next_branch_or_end",
        {tnid: atnId},
        function(json) {
          // See goToNextBranchOrEndNode for JSON schema description.
          // Construct a list of child nodes of the active node in case they are
          // not loaded in the overlay nodes.
          var additionalNodes = json.reduce(function (nodes, branch) {
            var child = branch[0];
            nodes[child[0]] = {
              id: child[0],
              x: child[1],
              y: child[2],
              z: child[3],
              skeleton_id: atn.skeleton_id,
              parent: atn
            };
            return nodes;
          }, {});
          if (atn.parent_id && (SkeletonAnnotations.isRealNode(atn.parent_id) ||
                                !self.nodes.hasOwnProperty(atn.parent_id)))
          {
            self.promiseNode(self.nodes[atn.parent_id]).then(function(parentId) {
              // Need to fetch the parent node first.
              self.submit(
                  django_url + project.id + "/node/get_location",
                  {tnid: parentId},
                  function(json) {
                    additionalNodes[atn.id] = {
                      id: atn.id,
                      x: atn.x,
                      y: atn.y,
                      z: atn.z,
                      skeleton_id: atn.skeleton_id,
                      parent: {
                        id: atn.parent_id,
                        x: json[1],
                        y: json[2],
                        z: json[3],
                        skeleton_id: atn.skeleton_id,
                      }
                    };
                    insertNode(additionalNodes);
                  });
            });
          } else insertNode(additionalNodes); // No need to fetch the parent.
        });
  });
};

/**
 * Remove and hide all node labels.
 */
SkeletonAnnotations.SVGOverlay.prototype.hideLabels = function() {
  document.getElementById( "trace_button_togglelabels" ).className = "button";
  this.removeLabels();
  this.show_labels = false;
};

/**
 * Remove all node labels in the view.  Empty the node labels array.
 */
SkeletonAnnotations.SVGOverlay.prototype.removeLabels = function() {
  for (var labid in this.labels) {
    if (this.labels.hasOwnProperty(labid)) {
      this.labels[labid].remove();
    }
  }
  this.labels = {};
};

/**
 * Return if labels are displayed.
 */
SkeletonAnnotations.SVGOverlay.prototype.getLabelStatus = function() {
  return this.show_labels;
};

/**
 * Show all labels.
 */
SkeletonAnnotations.SVGOverlay.prototype.showLabels = function() {
  this.show_labels = true;
  this.updateNodes(function() {
    document.getElementById( "trace_button_togglelabels" ).className = "button_active";
  });
};

/**
 * Hide labels if they are shown and show them if they are hidden.
 */
SkeletonAnnotations.SVGOverlay.prototype.toggleLabels = function() {
  if (this.getLabelStatus()) {
    this.hideLabels();
  } else {
    this.showLabels();
  }
};

/**
 * Test if the node with the given ID is loaded and display a warning if not.
 * Test also if the node is root and display a message if so. In both cases,
 * false is returned. False, otherwise.
 */
SkeletonAnnotations.SVGOverlay.prototype.checkLoadedAndIsNotRoot = function(nodeID) {
  if (null === nodeID || !this.nodes.hasOwnProperty(nodeID)) {
    CATMAID.warn("Cannot find node with ID " + nodeID);
    return false;
  }
  if (this.nodes[nodeID].isroot) {
    CATMAID.info("Node is already root!");
    return false;
  }
  return true;
};

/**
 * Reroots the skeleton to the node with the given ID. If the user confirms that
 * the rerooting should be done, a promise is used to ensure that even virtual
 * nodes are there.
 */
SkeletonAnnotations.SVGOverlay.prototype.rerootSkeleton = function(nodeID) {
  if (!this.checkLoadedAndIsNotRoot(nodeID)) return;
  if (!confirm("Do you really want to to reroot the skeleton?")) return;
  var self = this;
  this.promiseNode(this.nodes[nodeID]).then(function(nodeID) {
    self.submit(
        django_url + project.id + '/skeleton/reroot',
        {treenode_id: nodeID},
        function() { self.updateNodes(); } );
  });
};

/**
 * Split the skeleton of the given node (ID). If this node happens to be
 * virtual and the skeleton is editable, the node is created before the split
 * dialog is shown. For now, the user is responsible of removing this node
 * again.
 */
SkeletonAnnotations.SVGOverlay.prototype.splitSkeleton = function(nodeID) {
  if (!this.checkLoadedAndIsNotRoot(nodeID)) return;
  var self = this;
  var node = self.nodes[nodeID];
  // Make sure we have permissions to edit the neuron
  this.executeIfSkeletonEditable(node.skeleton_id, function() {
    // Make sure the load is not virtual
    self.promiseNode(node).then(function(nodeId) {
      // Make sure we reference the correct node and create a model
      node = self.nodes[nodeId];
      var name = NeuronNameService.getInstance().getName(node.skeleton_id);
      var model = new SelectionTable.prototype.SkeletonModel(node.skeleton_id, name, new THREE.Color().setRGB(1, 1, 0));
      /* Create the dialog */
      var dialog = new SplitMergeDialog({
        model1: model,
        splitNodeId: nodeId
      });
      dialog.onOK = function() {
        // Get upstream and downstream annotation set
        var upstream_set, downstream_set;
        if (self.upstream_is_small) {
          upstream_set = dialog.get_under_annotation_set();
          downstream_set = dialog.get_over_annotation_set();
        } else {
          upstream_set = dialog.get_over_annotation_set();
          downstream_set = dialog.get_under_annotation_set();
        }
        // Call backend
        self.submit(
            django_url + project.id + '/skeleton/split',
            {
              treenode_id: nodeId,
              upstream_annotation_map: JSON.stringify(upstream_set),
              downstream_annotation_map: JSON.stringify(downstream_set),
            },
            function () {
              self.updateNodes(function () { self.selectNode(nodeId); });
            },
            true); // block UI
      };
      dialog.show();
    });
  });
};

/**
 * Used to join two skeletons together. Permissions are checked at the server
 * side, returning an error if not allowed.
 */
SkeletonAnnotations.SVGOverlay.prototype.createTreenodeLink = function (fromid, toid) {
  if (fromid === toid) return;
  if (!this.nodes.hasOwnProperty(toid)) return;
  var self = this;
  // Get neuron name and id of the to-skeleton
  this.promiseNodes(this.nodes[fromid], this.nodes[toid]).then(function(nids) {
    var fromid = nids[0], toid=nids[1];
    self.submit(
      django_url + project.id + '/treenode/info',
      {treenode_id: toid},
      function(json) {
        var from_model = SkeletonAnnotations.sourceView.createModel();
        var to_skid = json['skeleton_id'];
        // Make sure the user has permissions to edit both the from and the to
        // skeleton.
        self.executeIfSkeletonEditable(from_model.id, function() {
          self.executeIfSkeletonEditable(to_skid, function() {
            // The function used to instruct the backend to do the merge
            var merge = function(annotation_set) {
              // The call to join will reroot the target skeleton at the shift-clicked treenode
              self.submit(
                django_url + project.id + '/skeleton/join',
                {
                  from_id: fromid,
                  to_id: toid,
                  annotation_set: JSON.stringify(annotation_set),
                },
                function (json) {
                  self.updateNodes(function() {
                    self.selectNode(toid);
                  });
                  // Trigger join, delete and change events
                  CATMAID.neuronController.trigger(
                      CATMAID.neuronController.EVENT_SKELETONS_JOINED, to_skid, from_model.id);
                  CATMAID.neuronController.trigger(
                      CATMAID.neuronController.EVENT_SKELETON_DELETED, to_skid);
                  CATMAID.neuronController.trigger(
                      CATMAID.neuronController.EVENT_SKELETON_CHANGED, from_model.id);
                },
                true); // block UI
            };

            // A method to use when the to-skeleton has multiple nodes
            var merge_multiple_nodes = function() {
              var to_color = new THREE.Color().setRGB(1, 0, 1);
              var to_model = new SelectionTable.prototype.SkeletonModel(
                  to_skid, json['neuron_name'], to_color);
              var dialog = new SplitMergeDialog({
                model1: from_model,
                model2: to_model
              });
              dialog.onOK = function() {
                merge(dialog.get_combined_annotation_set());
              };
              // Extend the display with the newly created line
              var extension = {};
              var p = self.nodes[SkeletonAnnotations.getActiveNodeId()],
                  c = self.nodes[toid];
              extension[from_model.id] = [
                  new THREE.Vector3(self.pix2physX(p.z, p.y, p.x),
                                    self.pix2physY(p.z, p.y, p.x),
                                    self.pix2physZ(p.z, p.y, p.x)),
                  new THREE.Vector3(self.pix2physX(c.z, c.y, c.x),
                                    self.pix2physY(c.z, c.y, c.x),
                                    self.pix2physZ(c.z, c.y, c.x))
              ];
              dialog.show(extension);
            };

            // A method to use when the to-skeleton has only a single node
            var merge_single_node = function() {
              /* Retrieve annotations for the to-skeleton and show th dialog if
               * there are some. Otherwise merge the single not without showing
               * the dialog.
               */
              NeuronAnnotations.retrieve_annotations_for_skeleton(to_skid,
                  function(annotations) {
                    if (annotations.length > 0) {
                      merge_multiple_nodes();
                    } else {
                      NeuronAnnotations.retrieve_annotations_for_skeleton(
                          from_model.id, function(annotations) {
                              merge(annotations.reduce(function(o, e) { o[e.name] = e.users[0].id; return o; }, {}));
                          });
                    }
                  });
            };

            /* If the to-node contains more than one node, show the dialog.
             * Otherwise, check if the to-node contains annotations. If so, show
             * the dialog. Otherwise, merge it right away and keep the
             * from-annotations.
             */
            self.executeDependentOnExistence(toid,
              self.executeDependentOnNodeCount.bind(self, toid, merge_single_node,
                merge_multiple_nodes),
              merge_multiple_nodes);
          });
      });
    });
  });
};

/**
 * Asynchronuously, create a link between the nodes @fromid and @toid of type
 * @link_type. It is expected, that both nodes are existant. All nodes are
 * updated after this.
 */
SkeletonAnnotations.SVGOverlay.prototype.createLink = function (fromid, toid,
    link_type, afterCreate)
{
  var self = this;
  this.submit(
      django_url + project.id + '/link/create',
      {pid: project.id,
       from_id: fromid,
       link_type: link_type,
       to_id: toid},
       function(json) {
         if (json.warning) CATMAID.warn(json.warning);
         self.updateNodes(afterCreate);
       });
};

/**
 * Create a single connector not linked to any treenode. If given a
 * completionCallback function, it is invoked with one argument: the ID of the
 * newly created connector.
 */
SkeletonAnnotations.SVGOverlay.prototype.createSingleConnector = function (
    phys_x, phys_y, phys_z, pos_x, pos_y, pos_z, confval, subtype, completionCallback)
{
  var self = this;
  this.submit(
      django_url + project.id + '/connector/create',
      {pid: project.id,
       confidence: confval,
       x: phys_x,
       y: phys_y,
       z: phys_z},
      function(jso) {
        // add treenode to the display and update it
        var nn = self.graphics.newConnectorNode(jso.connector_id, pos_x, pos_y,
            pos_z, 0, 5 /* confidence */, subtype, true);
        self.nodes[jso.connector_id] = nn;
        nn.createGraphics();
        self.activateNode(nn);
        if (typeof completionCallback !== "undefined") {
          completionCallback(jso.connector_id);
        }
      });
};

/**
 * Create a new postsynaptic treenode from a connector. We create the treenode
 * first, then we create the link from the connector.
 */
SkeletonAnnotations.SVGOverlay.prototype.createPostsynapticTreenode = function (
    connectorID, phys_x, phys_y, phys_z, radius, confidence, pos_x, pos_y, pos_z, afterCreate)
{
  this.createTreenodeWithLink(connectorID, phys_x, phys_y, phys_z, radius,
      confidence, pos_x, pos_y, pos_z, "postsynaptic_to", afterCreate);
};

/**
 * Create a new treenode that is postsynaptic to the given @connectorID.
 */
SkeletonAnnotations.SVGOverlay.prototype.createPresynapticTreenode = function (
    connectorID, phys_x, phys_y, phys_z, radius, confidence, pos_x, pos_y, pos_z, afterCreate)
{
  // Check that connectorID doesn't have a presynaptic treenode already (It is
  // also checked in the server on attempting to create a link. Here, it is
  // checked for convenience to avoid creating an isolated treenode for no
  // reason.)
  var connectorNode = this.nodes[connectorID];
  if (!connectorNode) {
    CATMAID.error("Connector #" + connectorID + " is not loaded. Browse to " +
        "its section and make sure it is selected.");
    return;
  }
  if (Object.keys(connectorNode.pregroup).length > 0) {
    CATMAID.warn("The connector already has a presynaptic node!");
    return;
  }
  this.createTreenodeWithLink(connectorID, phys_x, phys_y, phys_z, radius,
      confidence, pos_x, pos_y, pos_z, "presynaptic_to", afterCreate);
};

/**
 * Create a new treenode and link it immediately to the given connector with the
 * specified link_type.
 */
SkeletonAnnotations.SVGOverlay.prototype.createTreenodeWithLink = function (
    connectorID, phys_x, phys_y, phys_z, radius, confidence, pos_x, pos_y,
    pos_z, link_type, afterCreate)
{
  var self = this;
  this.submit(
      django_url + project.id + '/treenode/create',
      {pid: project.id,
       parent_id: -1,
       x: phys_x,
       y: phys_y,
       z: phys_z,
       radius: radius,
       confidence: confidence},
      function (jso) {
        var nid = parseInt(jso.treenode_id);
        // always create a new treenode which is the root of a new skeleton
        var nn = self.graphics.newNode(nid, null, null, radius, pos_x, pos_y,
            pos_z, 0, 5 /* confidence */, parseInt(jso.skeleton_id), true);
        // add node to nodes list
        self.nodes[nid] = nn;
        nn.createGraphics();
        // create link : new treenode postsynaptic_to or presynaptic_to
        // deactivated connectorID
        self.createLink(nid, connectorID, link_type, function() {
          // Use a new node reference, because createLink() triggers an update,
          // which potentially re-initializes node objects.
          var node = self.nodes[nid];
          // Trigger skeleton change event
          SkeletonAnnotations.trigger(SkeletonAnnotations.EVENT_SKELETON_CHANGED,
              node.skeleton_id);

          if (afterCreate) afterCreate(self, node);
        });
      });
};

/**
 * Caters both to the createInterpolatedNode and createTreenodeLinkInterpolated
 * functions, which are almost identical.
 */
SkeletonAnnotations.SVGOverlay.prototype.createInterpolatedNodeFn = function () {
  // Javascript is not multithreaded. The only pseudo-threadedness occurs in
  // the code execution between the AJAX request and the execution of the
  // callback; that is, no concurrency, but continuations. Therefore altering
  // the queue array is always safe.

  // Accumulate invocations of the createInterpolatedNode function
  var queue = [];

  // Function to handle the callback
  var handler = function (status, text, xml) {
    if (status !== 200) {
      queue.length = 0; // reset
      return false;
    }
    if (text && text !== " ") {
      var json = $.parseJSON(text);
      if (json.error) {
        CATMAID.error(json.error);
        queue.length = 0; // reset
      } else {
        // Check if any calls have accumulated
        if (queue.length > 1) {
          // Remove this call
          queue.shift();
          // Invoke the oldest of any accumulated calls
          requester(json.treenode_id, queue[0]);
        } else {
          var handleLastRequest = function(q, retries) {
            // If the node update was successful, handle the last queue element.
            var success = function () {
              // Trigger change event of skeleton and update node
              SkeletonAnnotations.trigger(
                  SkeletonAnnotations.EVENT_SKELETON_CHANGED, json.skeleton_id);
              q.self.selectNode(json.treenode_id);
              // Remove this call now that the active node is set properly
              queue.shift();
              // Invoke the oldest of any accumulated calls
              if (queue.length > 0) {
                requester(json.treenode_id, queue[0]);
              }
            };
            // This error call back makes sure there is no dead-lock when
            // updateNodes() (or another request in the submitter queue it
            // is in) fails.
            var error = function() {
              if (retries > 0) {
                handleLastRequest(q, retries - 1);
              } else {
                CATMAID.error("A required update of the node failed. Please" +
                    "reload CATMAID.");
              }
            };
            // Start a new continuation to update the nodes,
            // ensuring that the desired active node will be loaded
            // (Could not be loaded if the user scrolled away between
            // the creation of the node and its activation).
            q.self.updateNodes(success, json.treenode_id, error);
          };

          // Try three times to update the node data and finish the queue
          var q = queue[0];
          handleLastRequest(q, 3);
        }
      }
    }
    return true;
  };

  // Function to request interpolated nodes
  var requester = function(parent_id, q) {
    // Make sure the parent node is not virtual anymore, when called
    q.self.promiseNode(q.self.nodes[parent_id]).then(function(parent_id) {
      var stack = q.self.getStack();
      // Creates treenodes from atn to new node in each z section
      var post = {
          pid: project.id,
          x: q.phys_x,
          y: q.phys_y,
          z: q.phys_z,
          resz: stack.resolution.z,
          stack_translation_z: stack.translation.z,
          stack_id: project.focusedStack.id
      };
      var url;
      if (q.nearestnode_id) {
        url = '/skeleton/join_interpolated';
        post.from_id = parent_id;
        post.to_id = q.nearestnode_id;
        post.annotation_set = q.annotation_set;
      } else {
        url = '/treenode/create/interpolated';
        post.parent_id = parent_id;
      }
      requestQueue.register(django_url + project.id + url, "POST", post, handler);
    });
  };

  return function (phys_x, phys_y, phys_z, nearestnode_id, annotation_set) {
    queue.push({phys_x: phys_x,
                phys_y: phys_y,
                phys_z: phys_z,
                nearestnode_id: nearestnode_id,
                annotation_set: JSON.stringify(annotation_set),
                self: this});

    if (queue.length > 1) {
      return; // will be handled by the callback
    }

    if (!SkeletonAnnotations.getActiveNodeId()) {
        CATMAID.warn("No node selected!");
        return;
    }
    requester(SkeletonAnnotations.getActiveNodeId(), queue[0]);
  };
};

/**
 * Create a node and activate it. Expectes the parent node to be real or falsy,
 * i.e. not virtual.
 */
SkeletonAnnotations.SVGOverlay.prototype.createNode = function (parentID,
   phys_x, phys_y, phys_z, radius, confidence, pos_x, pos_y, pos_z, afterCreate)
{
  if (!parentID) { parentID = -1; }

  // Check if we want the newly create node to be a model of an existing empty neuron
  var selneuron = project.selectedObjects.selectedneuron;
  var useneuron = null === selneuron ? -1 : selneuron;

  var self = this;

  this.submit(
      django_url + project.id + '/treenode/create',
      {pid: project.id,
       parent_id: parentID,
       x: phys_x,
       y: phys_y,
       z: phys_z,
       radius: radius,
       confidence: confidence,
       useneuron: useneuron},
      function(jso) {
        // add treenode to the display and update it
        var nid = parseInt(jso.treenode_id);
        var skid = parseInt(jso.skeleton_id);

        // Trigger change event for skeleton
        SkeletonAnnotations.trigger(
              SkeletonAnnotations.EVENT_SKELETON_CHANGED, skid);

        // The parent will be null if there isn't one or if the parent Node
        // object is not within the set of retrieved nodes, but the parentID
        // will be defined.
        var nn = self.graphics.newNode(nid, self.nodes[parentID], parentID,
            radius, pos_x, pos_y, pos_z, 0, 5 /* confidence */, skid, true);

        self.nodes[nid] = nn;
        nn.createGraphics();
        // Obtain active_node_z prior to altering atn
        var active_node_z = SkeletonAnnotations.atn.z;
        // Set atn to be the newly created node
        self.activateNode(nn);
        // Append to parent and recolor
        if (parentID) {
          var parentNode = self.nodes[parentID];
          if (parentNode) {
            parentNode.addChildNode(nn);
            parentNode.updateColors();
          }
        }

        // Check whether the Z coordinate of the new node is beyond one section away
        // from the Z coordinate of the parent node (which is the active by definition)
        if (active_node_z !== null && Math.abs(active_node_z - nn.z) > self.stack.resolution.z) {
          CATMAID.msg('BEWARE', 'Node added beyond one section from its parent node!');
        }

        // Invoke callback if necessary
        if (afterCreate) afterCreate(self, nn);
      });
};

/**
 * Invoke the callback function after having pushed updated node coordinates
 * to the database. Virtual nodes are ignored.
 */
SkeletonAnnotations.SVGOverlay.prototype.updateNodeCoordinatesinDB = function (callback) {
  /**
   * Create a promise that will update all nodes in the back-end that need to be
   * synced.
   */
  function promiseUpdate() {
    /* jshint validthis: true */ // "this" will be bound to the SVG overlay
    return new Promise((function(resolve, reject) {
      var update = {treenode: [],
                    connector: []};
      var nodeIDs = Object.keys(this.nodes);
      for (var i = 0; i < nodeIDs.length; ++i) {
        var node = this.nodes[nodeIDs[i]];
        // only updated nodes that need sync, e.g.  when they changed position
        if (node.needsync && SkeletonAnnotations.isRealNode(node.id)) {
          node.needsync = false;
          update[node.type].push([node.id,
                                  this.pix2physX(node.z, node.y, node.x),
                                  this.pix2physY(node.z, node.y, node.x),
                                  this.pix2physZ(node.z, node.y, node.x)]);
        }
      }
      if (update.treenode.length > 0 || update.connector.length > 0) {
        requestQueue.register(
            django_url + project.id + '/node/update', 'POST',
            {
              t: update.treenode,
              c: update.connector
            },
            CATMAID.jsonResponseHandler(resolve, reject));
      } else {
        resolve(0);
      }
    }).bind(this));
  }

  // Queue node update as a promise
  var promise = this.submit.then(promiseUpdate.bind(this));
  // Queue callback, if there is any (it will get the results of the node update
  // as arguments automatically).
  if (CATMAID.tools.isFn(callback)) {
    promise = promise.then(callback);
  }

  return promise;
};


/**
 * Recreate all nodes (or reuse existing ones if possible).
 *
 * @param jso is an array of JSON objects, where each object may specify a Node
 *            or a ConnectorNode
 * @param extraNodes is an array of nodes that should be added additonally
 */
SkeletonAnnotations.SVGOverlay.prototype.refreshNodesFromTuples = function (jso, extraNodes) {
  // Reset nodes and labels
  this.nodes = {};
  // remove labels, but do not hide them
  this.removeLabels();

  // Prepare existing Node and ConnectorNode instances for reuse
  this.graphics.resetCache();

  // Add extra nodes
  if (extraNodes) {
    extraNodes.forEach(function(n) {
      this.nodes[n.id] = this.graphics.newNode(n.id, null, n.parent_id, n.radius,
          n.x, n.y, n.z, n.z - this.stack.z, n.confidence, n.skeleton_id, n.can_edit);
    }, this);
  }

  // Populate Nodes
  jso[0].forEach(function(a, index, array) {
    // a[0]: ID, a[1]: parent ID, a[2]: x, a[3]: y, a[4]: z, a[5]: confidence
    // a[8]: user_id, a[6]: radius, a[7]: skeleton_id, a[8]: user can edit or not
    var z = this.stack.projectToStackZ(a[4], a[3], a[2]);
    this.nodes[a[0]] = this.graphics.newNode(
      a[0], null, a[1], a[6],
      this.stack.projectToStackX(a[4], a[3], a[2]),
      this.stack.projectToStackY(a[4], a[3], a[2]),
      z, z - this.stack.z, a[5], a[7], a[8]);
  }, this);

  // Populate ConnectorNodes
  jso[1].forEach(function(a, index, array) {
    // Determine the connector node type. For now eveything with no or only
    // pre or post treenodes is treated as a synapse. If there are only
    // non-directional connectors, an abutting connector is assumed.
    var subtype = SkeletonAnnotations.SUBTYPE_SYNAPTIC_CONNECTOR;
    if (0 === a[5].length && 0 === a[6].length && 0 !== a[7].length) {
      subtype = SkeletonAnnotations.SUBTYPE_ABUTTING_CONNECTOR;
    }
    // a[0]: ID, a[1]: x, a[2]: y, a[3]: z, a[4]: confidence,
    // a[5]: presynaptic nodes as array of arrays with treenode id
    // and confidence, a[6]: postsynaptic nodes as array of arrays with treenode id
    // and confidence, a[7]: undirected nodes as array of arrays with treenode
    // id, a[8]: whether the user can edit the connector
    var z = this.stack.projectToStackZ(a[3], a[2], a[1]);
    this.nodes[a[0]] = this.graphics.newConnectorNode(
      a[0],
      this.stack.projectToStackX(a[3], a[2], a[1]),
      this.stack.projectToStackY(a[3], a[2], a[1]),
      z, z - this.stack.z, a[4], subtype, a[8]);
  }, this);

  // Disable any unused instances
  this.graphics.disableBeyond(jso[0].length, jso[1].length);

  // Now that all Node instances are in place, loop nodes again
  // and set correct parent objects and parent's children update
  jso[0].forEach(function(a, index, array) {
    var pn = this.nodes[a[1]]; // parent Node
    if (pn) {
      var nn = this.nodes[a[0]];
      // if parent exists, update the references
      nn.parent = pn;
      // update the parent's children
      pn.addChildNode(nn);
    }
  }, this);

  // Now that ConnectorNode and Node instances are in place,
  // set the pre and post relations
  jso[1].forEach(function(a, index, array) {
    // a[0] is the ID of the ConnectorNode
    var connector = this.nodes[a[0]];
    // a[5]: pre relation which is an array of arrays of tnid and tc_confidence
    a[5].forEach(function(r, i, ar) {
      // r[0]: tnid, r[1]: tc_confidence
      var tnid = r[0];
      var node = this.nodes[tnid];
      if (node) {
        // link it to pregroup, to connect it to the connector
        connector.pregroup[tnid] = {'treenode': node,
                                    'confidence': r[1]};
      }
    }, this);
    // a[6]: post relation which is an array of arrays of tnid and tc_confidence
    a[6].forEach(function(r, i, ar) {
      // r[0]: tnid, r[1]: tc_confidence
      var tnid = r[0];
      var node = this.nodes[tnid];
      if (node) {
        // link it to postgroup, to connect it to the connector
        connector.postgroup[tnid] = {'treenode': node,
                                     'confidence': r[1]};
      }
    }, this);
    // a[7]: other relation which is an array of arrays of tnid and tc_confidence
    a[7].forEach(function(r, i, ar) {
      // r[0]: tnid, r[1]: tc_confidence
      var tnid = r[0];
      var node = this.nodes[tnid];
      if (node) {
        // link it to postgroup, to connect it to the connector
        connector.undirgroup[tnid] = {'treenode': node,
                                      'confidence': r[1]};
      }
    }, this);
  }, this);

  // Create virtual nodes, if needed. These are nodes that are not actually on
  // the current section, but are created to represent the connection between a
  // child and a parent node that are not part of this section either.
  jso[0].forEach(function(a, index, array) {
    var n = this.nodes[a[0]];
    // Check if the node is above or below this section
    if (n.zdiff !== 0) {
      // Check if parent is also not in this section
      var p = n.parent;
      if (p && p.zdiff !== 0 && !CATMAID.tools.sameSign(n.zdiff, p.zdiff)) {
        var vn = createVirtualNode(this.graphics, n, p, this.stack.z);
        if (vn) {
          this.nodes[vn.id] = vn;
        }
      }
      // Check if children are not in section as well
      for (var cid in n.children) {
        var c = n.children[cid];
        if (c.zdiff !== 0 && !CATMAID.tools.sameSign(n.zdiff, c.zdiff)) {
          var vn = createVirtualNode(this.graphics, c, n, this.stack.z);
          if (vn) {
            this.nodes[vn.id] = vn;
          }
        }
      }
    }
  }, this);

  // Draw node edges first, including the ones for virtual nodes
  for (var i in this.nodes) {
    if (this.nodes.hasOwnProperty(i)) {
      this.nodes[i].drawEdges();
    }
  }

  
  // Now that all edges have been created, disable unused arrows
  this.graphics.disableRemainingArrows();

  // Create circles on top of the edges
  // so that the events reach the circles first
  for (var i in this.nodes) {
    if (this.nodes.hasOwnProperty(i)) {
      // Will only create it or unhide it if the node is to be displayed
      this.nodes[i].createCircle();
    }
  }

  if (this.getLabelStatus()) {
    // For every node ID
    var m = jso[2];
    // Scale labels relative to confidence text labels to account for overlay scaling.
    var fontSize = parseFloat(this.graphics.ArrowLine.prototype.confidenceFontSize) * 0.75;
    for (var nid in m) {
      if (m.hasOwnProperty(nid)) {
        var node = this.nodes[nid];
        this.labels[nid] = new OverlayLabel(nid, this.paper, node.x, node.y, fontSize, m[nid]);
      }
    }
  }

  // Warn about nodes not retrieved because of limit
  if (true === jso[3]) {
    var msg = "Did not retrieve all visible nodes--too many! Zoom in to " +
      "constrain the field of view.";
    CATMAID.statusBar.replaceLast("*WARNING*: " + msg);
    CATMAID.warn(msg);
    this.trigger(this.EVENT_HIT_NODE_DISPLAY_LIMIT);
  }

  /**
   * Create and return a virtual node. It is actually non-existant and the given
   * child and parent are connected directly. However, both of them (!) are not
   * part of the current section. The node will be placed on the XY plane of the
   * given Z. If child and parent have the same Z, null is returned.
   */
  function createVirtualNode(graphics, child, parent, z)
  {
    // Make sure child and parent are at different sections
    if (child.z === parent.z) {
      console.log('Child and parent have same Z, can\'t create virtual node.');
      return null;
    }

    // Define X and Y so that they are on the intersection of the line between
    // child and parent and the current section.
    var pos = CATMAID.tools.intersectLineWithZPlane(child.x, child.y, child.z,
        parent.x, parent.y, parent.z, z);

    // The ID should be different for the the same child and parent in
    // different Z sections to distinguish virtual nodes on different sections.
    // Therefore, Z is also part of the ID.
    var id = SkeletonAnnotations.getVirtualNodeID(child.id, parent.id, z);
    var r = -1;
    var c = 5;

    var vn = graphics.newNode(id, parent, parent.id, r, pos[0], pos[1], z, 0, c,
        child.skeleton_id, true);

    // Update child information of virtual node and parent as if the virtual
    // node was a real node. That is, replace the original child of the parent
    // with the virtual node, and add the original child as child of the virtual
    // node.
    delete parent.children[child.id];
    parent.numberOfChildren--;
    parent.addChildNode(vn);
    child.parent = vn;
    child.parent_id = id;
    vn.addChildNode(child);

    return vn;
  }
};

/**
 * When we pass a completedCallback to redraw, it's essentially always because
 * we want to know that, if any fetching of nodes was required for the redraw,
 * those nodes have now been fetched.  So, if we *do* need to call updateNodes,
 * we should pass it the completionCallback.  Otherwise, just fire the
 * completionCallback at the end of this method.
 */
SkeletonAnnotations.SVGOverlay.prototype.redraw = function( stack, completionCallback ) {
  // TODO: this should also check for the size of the containing
  // div having changed.  You can see this problem if you have
  // another window open beside one with the tracing overlay -
  // when you close the window, the tracing overlay window is
  // enlarged but will have extra nodes fetched for the exposed
  // area.

  var stack = this.stack;

  var doNotUpdate = stack.old_z == stack.z && stack.old_s == stack.s;
  if ( doNotUpdate )
  {
    var sPAD = this.PAD / stack.scale;
    var dx = this.old_x - stack.x;
    doNotUpdate = dx < sPAD && dx > -sPAD;
    
    if ( doNotUpdate )
    {
      var dy = this.old_y - stack.y;
      doNotUpdate = dy < sPAD && dy > -sPAD;
    }
  }

  doNotUpdate = doNotUpdate || this.suspended;

  var screenScale = userprofile.tracing_overlay_screen_scaling;
  this.paper.classed('screen-scale', screenScale);
  // All SVG elements scale automatcally, if the viewport on the SVG data
  // changes. If in screen scale mode, where the size of all elements should
  // stay the same (regardless of zoom level), counter acting this is required.
  var resScale = Math.max(stack.resolution.x, stack.resolution.y);
  var dynamicScale = screenScale ? (1 / (stack.scale * resScale)) : false;
  this.graphics.scale(userprofile.tracing_overlay_scale, resScale, dynamicScale);

  if ( !doNotUpdate ) {
    // If changing scale or slice, remove tagbox.
    SkeletonAnnotations.Tag.removeTagbox();
    this.updateNodes(completionCallback);
  }

  var stackViewBox = stack.createStackViewBox();

  // Use project coordinates for the SVG's view box
  this.paper.attr({
      viewBox: [
          stackViewBox.min.x,
          stackViewBox.min.y,
          stackViewBox.max.x - stackViewBox.min.x,
          stackViewBox.max.y - stackViewBox.min.y].join(' '),
      width: stack.viewWidth,     // Width and height only need to be updated on
      height: stack.viewHeight}); // resize.

  if (doNotUpdate) {
    if (typeof completionCallback !== "undefined") {
      completionCallback();
    }
  }
};

/**
 * TODO This doc below is obsolete
 * This isn't called "onclick" to avoid confusion - click events aren't
 * generated when clicking in the overlay since the mousedown and mouseup events
 * happen in different divs.  This is actually called from mousedown (or mouseup
 * if we ever need to make click-and-drag work with the left hand button too...)
 */
SkeletonAnnotations.SVGOverlay.prototype.whenclicked = function (e) {
  if (this.ensureFocused()) {
    e.stopPropagation();
    return;
  }

  // Only process the click event, if it was targeted at the view of this
  // overlay. The event is not stopped from bubbling up to make it possible to
  // handle at other places. Currently this triggers the activation of the other
  // view.
  if (e.currentTarget !== this.view) {
    return;
  }

  var m = CATMAID.ui.getMouse(e, this.view);

  if (!mayEdit()) {
    CATMAID.statusBar.replaceLast("You don't have permission.");
    e.stopPropagation();
    return;
  }

  // take into account current local offset coordinates and scale
  var pos_x = this.coords.lastX;
  var pos_y = this.coords.lastY;
  var pos_z = this.stack.z; // or this.phys2pixZ(project.coordinates.z);

  // get physical coordinates for node position creation
  var phys_x = this.pix2physX(pos_z, pos_y, pos_x);
  var phys_y = this.pix2physY(pos_z, pos_y, pos_x);
  var phys_z = this.pix2physZ(pos_z, pos_y, pos_x);

  var targetTreenodeID,
      atn = SkeletonAnnotations.atn;


  // If activated, edit the node radius right after it was created.
  var postCreateFn;
  if (SkeletonAnnotations.setRadiusAfterNodeCreation) {
    // Edit radius without showing the dialog and without centering.
    postCreateFn = function(overlay, node) { overlay.editRadius(node.id, false, true, true); };
  }

  // e.metaKey should correspond to the command key on Mac OS
  if (e.ctrlKey || e.metaKey) {
    if (e.altKey && null !== atn.id && SkeletonAnnotations.TYPE_NODE === atn.type) {
      // Insert a treenode along an edge on the active skeleton
      var respectVirtualNodes = true;
      this.insertNodeInActiveSkeleton(phys_x, phys_y, phys_z, atn, respectVirtualNodes);
      e.stopPropagation();
    } else {
      // ctrl-click deselects the current active node
      if (null !== atn.id) {
        CATMAID.statusBar.replaceLast("Deactivated node #" + atn.id);
      }
      SkeletonAnnotations.clearTopbar(this.stack.getId());
      this.activateNode(null);
      if (!e.shiftKey) {
        e.stopPropagation();
      } // else, a node under the mouse will be removed
    }
  } else if (e.shiftKey) {
    if (null === atn.id) {
      if (SkeletonAnnotations.currentmode === SkeletonAnnotations.MODES.SKELETON) {
        CATMAID.msg('BEWARE', 'You need to activate a treenode first (skeleton tracing mode)!');
        e.stopPropagation();
        return true;
      }
    } else {
      if (SkeletonAnnotations.TYPE_NODE === atn.type) {
        var targetTreenode = this.nodes[atn.id];
        if (e.shiftKey) {
          var msg, linkType, self = this;
          if (SkeletonAnnotations.SUBTYPE_ABUTTING_CONNECTOR === SkeletonAnnotations.newConnectorType) {
            // Create a new abutting connection
            msg = "Created abutting connector with treenode #" + atn.id;
            linkType = "abutting";
          } else if (SkeletonAnnotations.SUBTYPE_SYNAPTIC_CONNECTOR === SkeletonAnnotations.newConnectorType) {
            // Create a new synaptic connector
            var synapseType = e.altKey ? 'post' : 'pre';
            msg = "Created connector with " + synapseType + "synaptic treenode #" + atn.id;
            linkType = synapseType + "synaptic_to";
          } else {
            CATMAID.warn("Unknown connector type selected");
            return true;
          }
          CATMAID.statusBar.replaceLast(msg);
          this.createSingleConnector(phys_x, phys_y, phys_z, pos_x, pos_y, pos_z, 5,
            SkeletonAnnotations.newConnectorType, function (connectorID) {
                self.promiseNode(targetTreenode).then(function(nid) {
                  self.createLink(nid, connectorID, linkType);
                });
            });
          e.stopPropagation();
          e.preventDefault();
        }
        // Else don't stop propagation: the mouse functions of the node will be triggered
        return true;
      } else if (SkeletonAnnotations.TYPE_CONNECTORNODE === atn.type) {
        if (SkeletonAnnotations.SUBTYPE_SYNAPTIC_CONNECTOR === atn.subtype) {
          // create new treenode (and skeleton) postsynaptic to activated connector
          CATMAID.statusBar.replaceLast("Created treenode #" + atn.id + " postsynaptic to active connector");
          this.createPostsynapticTreenode(atn.id, phys_x, phys_y, phys_z, -1, 5,
              pos_x, pos_y, pos_z, postCreateFn);
          e.stopPropagation();
        } else if (SkeletonAnnotations.SUBTYPE_ABUTTING_CONNECTOR === atn.subtype) {
          // create new treenode (and skeleton) postsynaptic to activated connector
          CATMAID.statusBar.replaceLast("Created treenode #" + atn.id + " abutting to active connector");
          this.createTreenodeWithLink(atn.id, phys_x, phys_y, phys_z, -1, 5,
              pos_x, pos_y, pos_z, "abutting", postCreateFn);
          e.stopPropagation();
        }
        return true;
      }
    }
  } else {
    // depending on what mode we are in do something else when clicking
    if (SkeletonAnnotations.currentmode === SkeletonAnnotations.MODES.SKELETON) {
      if (SkeletonAnnotations.TYPE_NODE === atn.type || null === atn.id) {
        // Create a new treenode, either root node if atn is null, or child if
        // it is not null
        if (null !== atn.id) {
          // Make sure the parent exists
          atn.promise().then((function(atnId) {
            CATMAID.statusBar.replaceLast("Created new node as child of node #" + atn.id);
            this.createNode(atnId, phys_x, phys_y, phys_z, -1, 5,
                pos_x, pos_y, pos_z, postCreateFn);
          }).bind(this));
        } else {
            // Create root node
            this.createNode(null, phys_x, phys_y, phys_z, -1, 5,
                pos_x, pos_y, pos_z, postCreateFn);
        }
        e.stopPropagation();
      } else if (SkeletonAnnotations.SUBTYPE_SYNAPTIC_CONNECTOR === atn.subtype) {
        // create new treenode (and skeleton) presynaptic to activated connector
        // if the connector doesn't have a presynaptic node already
        this.createPresynapticTreenode(atn.id, phys_x, phys_y, phys_z, -1, 5, pos_x, pos_y, pos_z,
            postCreateFn);
        e.stopPropagation();
      }
      // Else don't stop propagation: a node may be moved
      return true;
    } else if (SkeletonAnnotations.currentmode === SkeletonAnnotations.MODES.SYNAPSE) {
      // only create single synapses/connectors
      this.createSingleConnector(phys_x, phys_y, phys_z, pos_x, pos_y, pos_z, 5,
          SkeletonAnnotations.newConnectorType);
    }
  }
  e.stopPropagation();
  return true;
};

SkeletonAnnotations.SVGOverlay.prototype.phys2pixX = function (z, y, x) {
  return this.stack.projectToStackX(z, y, x);
};
SkeletonAnnotations.SVGOverlay.prototype.phys2pixY = function (z, y, x) {
  return this.stack.projectToStackY(z, y, x);
};
SkeletonAnnotations.SVGOverlay.prototype.phys2pixZ = function (z, y, x) {
  return this.stack.projectToStackZ(z, y, x);
};
SkeletonAnnotations.SVGOverlay.prototype.pix2physX = function (z, y, x) {
  return this.stack.stackToProjectX(z, y, x);
};
SkeletonAnnotations.SVGOverlay.prototype.pix2physY = function (z, y, x) {
  return this.stack.stackToProjectY(z, y, x);
};
SkeletonAnnotations.SVGOverlay.prototype.pix2physZ = function (z, y, x) {
  return this.stack.stackToProjectZ(z, y, x);
};

SkeletonAnnotations.SVGOverlay.prototype.show = function () {
  this.view.style.display = "block";
};

SkeletonAnnotations.SVGOverlay.prototype.hide = function () {
  this.view.style.display = "none";
};

/**
 * Update treeline nodes by querying them from the server with the bounding
 * volume of the current view. Will also push editions (if any) to nodes to the
 * database.
 */
SkeletonAnnotations.SVGOverlay.prototype.updateNodes = function (callback,
    future_active_node_id, errCallback) {
  var self = this;

  if (this.suspended) {
    return;
  }

  this.updateNodeCoordinatesinDB(function () {
    // stack.viewWidth and .viewHeight are in screen pixels
    // so they must be scaled and then transformed to nanometers
    // and stack.x, .y are in absolute pixels, so they also must be brought to nanometers
    var atnid = -1; // cannot send a null
    var atntype = "";
    if (SkeletonAnnotations.getActiveNodeId() &&
        SkeletonAnnotations.TYPE_NODE === SkeletonAnnotations.getActiveNodeType()) {
      if (future_active_node_id) {
        atnid = future_active_node_id;
      } else {
        atnid = SkeletonAnnotations.getActiveNodeId();
      }
    }
    // Include ID only in qery, if it is real
    var extraNodes;
    if (!SkeletonAnnotations.isRealNode(atnid)) {
      var n = self.nodes[atnid];
      if (n) {
        extraNodes = [{
          id: n.id,
          parent_id: n.parent_id,
          radius: n.radius,
          x: n.x,
          y: n.y,
          z: n.z,
          confidence: n.confidence,
          skeleton_id: n.skeleton_id,
          can_edit: n.can_edit
        }];
      } else {
        console.log('Could not pin virtual node before update: ' + atnid);
      }
      atnid = -1;
    }

    var stack = self.stack;
    self.old_x = stack.x;
    self.old_y = stack.y;

    // (stack.y - (stack.viewHeight / 2) / stack.scale) * stack.resolution.y + stack.translation.y

    var halfWidth =  (stack.viewWidth  / 2) / stack.scale,
        halfHeight = (stack.viewHeight / 2) / stack.scale;

    var x0 = stack.x - halfWidth,
        y0 = stack.y - halfHeight,
        z0 = stack.z;

    var x1 = stack.x + halfWidth,
        y1 = stack.y + halfHeight,
        z1 = stack.z + 1; // stack.z is always in discreet units

    var wx0 = stack.stackToProjectX(z0, y0, x0),
        wy0 = stack.stackToProjectY(z0, y0, x0),
        wz0 = stack.stackToProjectZ(z0, y0, x0);

    var wx1 = stack.stackToProjectX(z1, y1, x1),
        wy1 = stack.stackToProjectY(z1, y1, x1),
        wz1 = stack.stackToProjectZ(z1, y1, x1);

    var params = {
      left: wx0,
      top: wy0,
      z1: wz0,
      right: wx1,
      bottom: wy1,
      z2: wz1,
      atnid: atnid,
      labels: self.getLabelStatus()
    };

    var url = django_url + project.id + '/node/list';
    self.submit(
      url,
      params,
      function(json) {
        if (json.needs_setup) {
            display_tracing_setup_dialog(project.id, json.has_needed_permissions,
                json.missing_classes, json.missing_relations,
                json.missing_classinstances);
        } else {
          self.refreshNodesFromTuples(json, extraNodes);

          // initialization hack for "URL to this view"
          if (SkeletonAnnotations.hasOwnProperty('init_active_node_id')) {
            self.activateNode(self.nodes[SkeletonAnnotations.init_active_node_id]);
            delete SkeletonAnnotations.init_active_node_id;
          }

          self.redraw();
          if (typeof callback !== "undefined") {
            callback();
          }
        }
      },
      false,
      true,
      errCallback,
      false,
      'stack-' + self.stack.id + '-url-' + url);
  });
};

/**
 * Set the confidence of the edge partig from the active node towards either the
 * parent or a connector. If there is more than one connector, the confidence is
 * set to all connectors.
 */
SkeletonAnnotations.SVGOverlay.prototype.setConfidence = function(newConfidence, toConnector) {
  var nodeID = SkeletonAnnotations.getActiveNodeId();
  if (!nodeID) return;
  var node = this.nodes[nodeID];
  if (!node || 'treenode' !== node.type) {
    return;
  }
  if (node.parent_id || toConnector) {
    var self = this;
    this.promiseNode(node).then(function(nid) {
      self.submit(
          django_url + project.id + '/node/' + nid + '/confidence/update',
          {pid: project.id,
          to_connector: toConnector,
          tnid: nid,
          new_confidence: newConfidence},
          function(json) {
            self.updateNodes();
          });
    });
  }
};

/**
 * Test if a node ID properly defined.
 *
 * @nodeID The ID to test
 * @return false if the nodeID is falsy, true otherwise
 */
SkeletonAnnotations.SVGOverlay.prototype.isIDNull = function(nodeID) {
  if (!nodeID) {
    CATMAID.info("Select a node first!");
    return true;
  }
  return false;
};

/**
 * Move to the previous branch point or the root node, if former is not
 * available. If the treenode is virtual, it's real child is used instead.
 */
SkeletonAnnotations.SVGOverlay.prototype.goToPreviousBranchOrRootNode = function(treenode_id, e) {
  if (this.isIDNull(treenode_id)) return;
  if (!SkeletonAnnotations.isRealNode(treenode_id)) {
    // Use child of virtual node, to make sure a branch before the virtual node
    // is seen.
    treenode_id = SkeletonAnnotations.getChildOfVirtualNode(treenode_id);
  }
  var self = this;
  this.submit(
      django_url + project.id + "/node/previous_branch_or_root",
      {tnid: treenode_id,
       alt: e.altKey ? 1 : 0},
      function(json) {
        // json is a tuple:
        // json[0]: treenode id
        // json[1], [2], [3]: x, y, z in calibrated world units
        if (treenode_id === json[0]) {
          // Already at the root node
          CATMAID.msg('Already there', 'You are already at the root node');
          // Center already selected node
          self.moveTo(json[3], json[2], json[1]);
        } else {
          self.moveTo(json[3], json[2], json[1],
            function() {
              self.selectNode(json[0], json[4]);
            });
        }
      });
};

/**
 * Move to the next branch point or end node, if former is not available. If the
 * treenode is virtual, it's real parent is used instead. Pressing shift will
 * cause cylcing though all branches.
 */
SkeletonAnnotations.SVGOverlay.prototype.goToNextBranchOrEndNode = function(treenode_id, e) {
  if (this.isIDNull(treenode_id)) return;
  if (!SkeletonAnnotations.isRealNode(treenode_id)) {
    // Use parent of virtual node, to make sure a branch after the virtual node
    // is seen.
    treenode_id = SkeletonAnnotations.getParentOfVirtualNode(treenode_id);
  }
  if (e.shiftKey) {
    this.cycleThroughBranches(treenode_id, e.altKey ? 1 : 2);
  } else {
    var self = this;
    this.submit(
        django_url + project.id + "/node/next_branch_or_end",
        {tnid: treenode_id},
        function(json) {
          // json is an array of branches
          // each branch is a tuple:
          // [child head of branch, first node of interest, first branch or leaf]
          // each node is a tuple:
          // node[0]: treenode id
          // node[1], [2], [3]: x, y, z in calibrated world units
          if (json.length === 0) {
            // Already at a branch or end node
            CATMAID.msg('Already there', 'You are at an end node');
            // Center already selected node
            var atn = SkeletonAnnotations.atn;
            if (atn) {
              self.moveTo(atn.z, atn.y, atn.x);
            }
          } else {
            self.nextBranches = {tnid: treenode_id, branches: json};
            self.cycleThroughBranches(null, e.altKey ? 1 : 2);
          }
        });
  }
};

/**
 * Select alternative branches to the currently selected one
 */
SkeletonAnnotations.SVGOverlay.prototype.cycleThroughBranches = function (treenode_id, node_index) {
  if (typeof this.nextBranches === 'undefined') return;
  if (!this.isIDNull(treenode_id) && !SkeletonAnnotations.isRealNode(treenode_id)) {
    treenode_id = SkeletonAnnotations.getChildOfVirtualNode(treenode_id);
  }

  var currentBranch = this.nextBranches.branches.map(function (branch) {
    return branch.some(function (node) { return node[0] === treenode_id; });
  }).indexOf(true);

  // Cycle through branches. If treenode_id was not in the branch nodes (such as
  // when first selecting a branch), currentBranch will be -1, so the following
  // line will make it 0 and still produce the desired behavior.
  currentBranch = (currentBranch + 1) % this.nextBranches.branches.length;

  var branch = this.nextBranches.branches[currentBranch];
  var node = branch[node_index];

  this.getNodeOnSectionInRange(node[0], this.nextBranches.tnid, true)
    .then((function(node) { this.moveToAndSelectNode(node.id); }).bind(this));
};

/**
 * Checks first if the parent is loaded, otherwise fetches its location from the
 * database.
 */
SkeletonAnnotations.SVGOverlay.prototype.goToParentNode = function(treenode_id) {
  if (this.isIDNull(treenode_id)) return;
  var node = this.nodes[treenode_id];
  if (!node) {
    CATMAID.error("Could not find node with id #" + treenode_id);
    return;
  }
  if (node.isroot) {
    CATMAID.info("This is the root node, can't move to its parent");
    return;
  }

  this.moveToAndSelectNode(node.parent_id);
};

/**
 * Move to the parent node of the given node. Usually, this is the node at the
 * intersection between the the skeleton of the given node and the section
 * towards its parent. If this happens to be a real node, the real node is
 * loaded (if required) and selected, otherwise, a virtual node is selected.
 * Optionally, the selection of virtual nodes can be disabled. This might cause
 * a jump to a location that is farther away than one section.
 */
SkeletonAnnotations.SVGOverlay.prototype.goToParentNode = function(treenode_id, ignoreVirtual) {
  if (this.isIDNull(treenode_id)) return;
  var node = this.nodes[treenode_id];
  if (!node) {
    CATMAID.error("Could not find node with id #" + treenode_id);
    return;
  }
  if (node.isroot) {
    CATMAID.info("This is the root node, can't move to its parent");
    return;
  }
  if (ignoreVirtual) {
    this.moveToAndSelectNode(node.parent_id);
  } else {
    this.getNodeOnSectionInRange(node.id, node.parent_id, false)
      .then((function(node) { this.moveToAndSelectNode(node.id); }).bind(this));
  }
};

/**
 * Select either the node stored in nextBranches or, if this is not available,
 * the next branch or end node is fetched from the back end.
 *
 * @param {number} treenode_id - The node of which to select the child
 * @param {boolean} cycle - If true, subsequent calls cycle through children
 */
SkeletonAnnotations.SVGOverlay.prototype.goToChildNode = function (treenode_id, cycle, ignoreVirtual) {
  if (this.isIDNull(treenode_id)) return;
  // If the existing nextBranches was fetched for this treenode, reuse it to
  // prevent repeated queries when quickly alternating between child and parent.
  if (cycle ||
      typeof this.nextBranches !== 'undefined' && this.nextBranches.tnid === treenode_id) {
        this.cycleThroughBranches(treenode_id, 0);
  } else {
    var self = this;
    this.submit(
        django_url + project.id + "/node/next_branch_or_end",
        {tnid: treenode_id},
        function(json) {
          // See goToNextBranchOrEndNode for JSON schema description.
          if (json.length === 0) {
            // Already at a branch or end node
            CATMAID.msg('Already there', 'You are at an end node');
          } else {
            self.nextBranches = {tnid: treenode_id, branches: json};
            self.cycleThroughBranches(null, 0);
          }
        });
  }
};

/**
 * Lets the user select a radius around a node with the help of a small
 * measurement tool, passing the selected radius to a callback when finished.
 */
SkeletonAnnotations.SVGOverlay.prototype.selectRadius = function(treenode_id, no_centering, completionCallback) {
  if (this.isIDNull(treenode_id)) return;
  var self = this;
  // References the original node the selector was created for
  var originalNode;

  if (no_centering) {
    toggleMeasurementTool();
  } else {
    this.goToNode(treenode_id, toggleMeasurementTool);
  }

  function verifyNode(treenode_id) {
    var node = self.nodes[treenode_id];
    if (!node || node !== originalNode) {
      // This can happen if e.g. the section was changed and all nodes were
      // updated.
      CATMAID.warn('Canceling radius editing, because the edited node ' +
          'cannot be found anymore or has changed.');
      return false;
    }
    return node;
  }

  function toggleMeasurementTool() {
    // Keep a reference to the original node
    originalNode = self.nodes[treenode_id];
    // If there was a measurement tool based radius selection started
    // before, stop this.
    if (originalNode.surroundingCircleElements) {
      hideCircleAndCallback();
    } else {
      originalNode.drawSurroundingCircle(toStack, stackToProject,
          hideCircleAndCallback);
      // Attach a handler for the ESC key to cancel selection
      $('body').on('keydown.catmaidRadiusSelect', function(event) {
        if (27 === event.keyCode) {
          // Unbind key handler and remove circle
          $('body').off('keydown.catmaidRadiusSelect');
          originalNode.removeSurroundingCircle();
          return true;
        }
        return false;
      });
    }

    function hideCircleAndCallback()
    {
      // Unbind key handler
      $('body').off('keydown.catmaidRadiusSelect');
      var node = verifyNode(treenode_id);
      if (!node) {
        // Remove circle from node we originally attached to and cancel, if no
        // node for the given ID was found.
        originalNode.removeSurroundingCircle();
      } else {
        // Remove circle and call callback
        node.removeSurroundingCircle(function(rx, ry) {
          if (typeof rx === 'undefined' || typeof ry === 'undefined') {
            completionCallback(undefined);
            return;
          }
          // Convert pixel radius components to nanometers
          var prx = self.stack.stackToProjectX(self.stack.z, ry, rx),
              pry = self.stack.stackToProjectY(self.stack.z, ry, rx),
              pr = Math.round(Math.sqrt(Math.pow(prx, 2) + Math.pow(pry, 2)));
          // Callback with the selected radius
          completionCallback(pr);
        });
      }
    }

    /**
     * Transform a layer coordinate into stack space.
     */
    function toStack(r)
    {
      var offsetX = self.stack.x - self.stack.viewWidth / self.stack.scale / 2;
      var offsetY = self.stack.y - self.stack.viewHeight / self.stack.scale / 2;
      return {
        x: (r.x / self.stack.scale) + offsetX,
        y: (r.y / self.stack.scale) + offsetY
      };
    }

    /**
     * Transform a layer coordinate into world space.
     */
    function stackToProject(s)
    {
      return {
        x: self.stack.stackToProjectX(self.stack.z, s.y, s.x),
        y: self.stack.stackToProjectY(self.stack.z, s.y, s.x)
      };
    }
  }
};

/**
 * Shows a dialog to edit the radius property of a node. By default, it also
 * lets the user estimate the radius with the help of a small measurement tool,
 * which can be disabled by setting the no_measurement_tool parameter to true.
 * If the measurement tool is used, the dialog display can optionally be
 * disabled
 */
SkeletonAnnotations.SVGOverlay.prototype.editRadius = function(treenode_id, no_measurement_tool, no_centering, no_dialog) {
  if (this.isIDNull(treenode_id)) return;
  var self = this;

  function updateRadius(radius, updateMode) {
    // Default update mode to this node only
    updateMode = updateMode || 0;
    self.promiseNode(treenode_id).then(function(nodeID) {
      self.submit(
        django_url + project.id + '/treenode/' + nodeID + '/radius',
        {radius: radius,
         option: updateMode},
        function(json) {
          // Refresh 3d views if any
          WebGLApplication.prototype.staticReloadSkeletons([self.nodes[nodeID].skeleton_id]);
          // Reinit SVGOverlay to read in the radius of each altered treenode
          self.updateNodes();
        });
    });
  }

  function show_dialog(defaultRadius) {
    if (typeof defaultRadius === 'undefined')
      defaultRadius = self.nodes[treenode_id].radius;

    var dialog = new CATMAID.OptionsDialog("Edit radius");
    var input = dialog.appendField("Radius: ", "treenode-edit-radius", defaultRadius);
    var choice = dialog.appendChoice("Apply: ", "treenode-edit-radius-scope",
      ['Only this node', 'From this node to the next branch or end node (included)',
       'From this node to the previous branch node or root (excluded)',
       'From this node to the previous node with a defined radius (excluded)',
       'From this node to root (included)', 'All nodes'],
      [0, 1, 2, 3, 4, 5],
      self.editRadius_defaultValue);
    dialog.onOK = function() {
      var radius = parseFloat(input.value);
      if (isNaN(radius)) {
        alert("Invalid number: '" + input.value + "'");
        return;
      }
      self.editRadius_defaultValue = choice.selectedIndex;
      updateRadius(radius, choice.selectedIndex);
    };
    dialog.show('auto', 'auto');
  }

  if (no_measurement_tool) {
    if (no_centering) {
      show_dialog(this.nodes[treenode_id].radius);
    } else {
      this.goToNode(treenode_id, show_dialog(this.nodes[treenode_id].radius));
    }
  } else {
    this.selectRadius(treenode_id, no_centering, no_dialog ? updateRadius : show_dialog);
  }
};

/**
 * All moving functions must perform moves via the updateNodeCoordinatesinDB
 * otherwise, coordinates for moved nodes would not be updated.
 */
SkeletonAnnotations.SVGOverlay.prototype.moveTo = function(z, y, x, fn) {
  var stack = this.stack;
  this.updateNodeCoordinatesinDB(function() {
    stack.getProject().moveTo(z, y, x, undefined, fn);
  });
};


/**
 * Move to a node and select it. Can handle virtual nodes.
 */
SkeletonAnnotations.SVGOverlay.prototype.moveToAndSelectNode = function(nodeID, fn) {
  if (this.isIDNull(nodeID)) return;
  var self = this;
  this.goToNode(nodeID,
      function() {
        self.selectNode(nodeID);
        if (fn) fn();
      });
};

/**
 * Move to the node and then invoke the function. If the node happens to be
 * virtual and not available in the front-end already, it tries to get both
 * real parent and real child of it and determine the correct position.
 */
SkeletonAnnotations.SVGOverlay.prototype.goToNode = function (nodeID, fn) {
  if (this.isIDNull(nodeID)) return;
  var node = this.nodes[nodeID];
  if (node) {
    this.moveTo(
      this.pix2physZ(node.z, node.y, node.x),
      this.pix2physY(node.z, node.y, node.x),
      this.pix2physX(node.z, node.y, node.x),
      fn);
  } else if (SkeletonAnnotations.isRealNode(nodeID)) {
    var self = this;
    this.submit(
        django_url + project.id + "/node/get_location",
        {tnid: nodeID},
        function(json) {
          // json[0], [1], [2], [3]: id, x, y, z
          self.moveTo(json[3], json[2], json[1], fn);
        },
        false,
        true);
  } else {
    // Get parent and child ID locations
    var vnComponents = SkeletonAnnotations.getVirtualNodeComponents(nodeID);
    var parentID = SkeletonAnnotations.getParentOfVirtualNode(nodeID, vnComponents);
    var childID = SkeletonAnnotations.getChildOfVirtualNode(nodeID, vnComponents);
    var vnZ = SkeletonAnnotations.getZOfVirtualNode(nodeID, vnComponents);
    if (parentID && childID && vnZ) {
      // Query parent location
      this.submit(
          django_url + project.id + "/node/get_location",
          {tnid: parentID},
          function(json) {
            var p = {x: json[1], y: json[2], z: json[3]};
            // Query child location
            self.submit(
                django_url + project.id + "/node/get_location",
                {tnid: childID},
                function(json) {
                  var c = {x: json[1], y: json[2], z: json[3]};
                  // Find intersection at virtual node
                  var pos = CATMAID.tools.intersectLineWithZPlane(c.x, c.y, c.z,
                      p.x, p.y, p.z, vnZ);
                  // Move there
                  self.moveTo(vnZ, pos[1], pos[0], fn);
                },
                false,
                true);
          },
          false,
          true);
    } else {
      CATMAID.warn("Could not find location for node " + nodeID);
    }
  }
};

/**
 * Get a node representing the location on a skeleton at the first section after
 * the first of two adjacent nodes in direction of the second. If reverse is
 * true, a node on the first section after the second node in direction of the
 * first will be returned. More precisely, a promise is returned that is
 * resolved once the node is available. The promise returns the node
 * representing the location in question. Note that this node can be a virtual
 * node if no real node is available at the given point in space. In this case,
 * the nodes are child and parent of the virtual node. If one of the two nodes
 * happens to be at the given Z, the respective node is returned.
 */
SkeletonAnnotations.SVGOverlay.prototype.getNodeOnSectionInRange = function (
    childID, parentID, reverse) {
  var self = this;

  if (childID === parentID) {
    throw new CATMAID.ValueError("Node IDs must be different");
  }

  return new Promise(function(resolve, reject) {
    // Promise location, either by using the existing node or getting location
    // informmation from the backend.
    var usedNodes = new Set([childID, parentID]);
    var location1 = promiseLocation(childID, usedNodes);
    var location2 = promiseLocation(parentID, usedNodes);

    // If both locations are available, find intersection at requested Z
    Promise.all([location1, location2]).then(function(locations) {
      var from = reverse ? locations[1] : locations[0],
            to = reverse ? locations[0] : locations[1],
          toID = reverse ? parentID : childID;
      var z = from.z + ((from.z < to.z) ? 1 : -1);

      // If the target node matches this Z, return it instead of a virtual node
      if (Math.abs(z - to.z) < 0.0001) {
        return {id: toID, x: to.x, y: to.y, z: to.z};
      }

      // Find intersection and return virtual node
      var pos = CATMAID.tools.intersectLineWithZPlane(from.x, from.y, from.z,
          to.x, to.y, to.z, z);
      var vnID = SkeletonAnnotations.getVirtualNodeID(childID, parentID, z);
      return {id: vnID, x: pos.x, y: pos.y, z: z};
    }).then(function(node) {
      // Convert previous result to project cooridnates
      return {
        id: node.id,
        x: self.stack.stackToProjectX(node.z, node.y, node.x),
        y: self.stack.stackToProjectY(node.z, node.y, node.x),
        z: self.stack.stackToProjectZ(node.z, node.y, node.x)
      } 
    }).then(resolve).catch(reject);

    /**
     * Return a promise that returns the location of the node with the given ID.
     * If a virtual node is used, its real child or parent will be used for a
     * location query.
     */
    function promiseLocation(nodeID, usedNodes) {
      var node = self.nodes[nodeID];
      if (node) {
        usedNodes.add(node.id);
        return Promise.resolve({x: node.x, y: node.y, z: node.z});
      } else {
        // In case of a vitual node, use its real child. Or, if the child has
        // been used for a node already (e.g. because is is the other node), use
        // its real parent.
        if (!SkeletonAnnotations.isRealNode(nodeID)) {
          var childID = SkeletonAnnotations.getChildOfVirtualNode(nodeID);
          if (usedNodes.has(childID)) {
            var parentID = SkeletonAnnotations.getParentOfVirtualNode(nodeID);
            if (usedNodes.has(parentID)) {
              throw new CATMAID.ValueError("Both parent and child of virtual " +
                  "node have been used already. Running out of options.");
            } else {
              nodeID = parentID;
            }
          } else {
            nodeID = childID;
          }
          // To request a location, nodeID can't be virtual. This should be dealt
          // with already, but another sanity check is done to be sure.
          if (!SkeletonAnnotations.isRealNode(nodeID)) {
            throw new CATMAID.ValueError("Couldn't find real node for location request.");
          }
        }

        // Mark node as used
        usedNodes.add(nodeID);

        // Request location from backend if the node is not available already
        node = self.nodes[nodeID];
        
        var url = django_url + project.id + "/node/get_location";
        return self.submit(url, {tnid: nodeID}, false, true, reject)
          .then(function(json) {
            return { 
              id: json[0],
              x: self.stack.projectToStackX(json[3], json[2], json[1]),
              y: self.stack.projectToStackY(json[3], json[2], json[1]),
              z: self.stack.projectToStackZ(json[3], json[2], json[1])
            };
          });
      }
    }
  });
};

/**
 * Move to the node that was edited last and select it. This will always be a
 * real node.
 */
SkeletonAnnotations.SVGOverlay.prototype.goToLastEditedNode = function(skeletonID) {
  if (this.isIDNull(skeletonID)) return;
  if (!skeletonID) return;
  var self = this;
  this.submit(
    django_url + project.id + '/node/most_recent',
    {pid: project.id,
     treenode_id: SkeletonAnnotations.getActiveNodeId()},
    function (jso) {
      self.moveTo(jso.z, jso.y, jso.x,
        function() { self.selectNode(jso.id); });
    });
};

/**
 * Move to the next open end end relative to the active node, and select it. If
 * cyling is requested, all buffered open ends will be selected one after each
 * other. If a virtual node is passed in, the request is done for its real
 * parent.
 */
SkeletonAnnotations.SVGOverlay.prototype.goToNextOpenEndNode = function(nodeID, cycle, byTime) {
  if (this.isIDNull(nodeID)) return;
  if (cycle) {
    this.cycleThroughOpenEnds(nodeID, byTime);
  } else {
    var self = this;
    if (!SkeletonAnnotations.isRealNode(nodeID)) {
      nodeID = SkeletonAnnotations.getParentOfVirtualNode(nodeID);
    }
    var skid = SkeletonAnnotations.getActiveSkeletonId();
    // TODO could be done by inspecting the graph locally if it is loaded in the
    // 3D viewer or treenode table (but either source may not be up to date)
    this.submit(
        django_url + project.id + '/skeleton/' + skid + '/openleaf',
        {tnid: nodeID},
        function (json) {
          // json is an array of nodes. Each node is an array:
          // [0]: open end node ID
          // [1]: location array as [x, y, z]
          // [2]: distance (path length)
          // [3]: creation_time
          if (0 === json.length) {
            CATMAID.info("No more open ends!");
            self.nextOpenEnds = { tnid: nodeID, skid: skid, ends: [], byTime: null };
          } else {
            self.nextOpenEnds = { tnid: nodeID, skid: skid, ends: json, byTime: null };
            self.cycleThroughOpenEnds(nodeID, byTime);
          }
        });
  }
};

/**
 * If there are open ends buffered, move to the next one after the current and
 * (or the first) and select the node. If sorting by time is requested and no
 * sorting took place so for, sort all open ends by time.
 */
SkeletonAnnotations.SVGOverlay.prototype.cycleThroughOpenEnds = function (treenode_id, byTime) {
  if (typeof this.nextOpenEnds === 'undefined' ||
      this.nextOpenEnds.ends.length === 0 ||
      this.nextOpenEnds.skid !== SkeletonAnnotations.getActiveSkeletonId()) {
    // Can not cycle because open ends data is missing or invalid. Fetch it.
    return this.goToNextOpenEndNode(treenode_id, false, byTime);
  }

  if (byTime !== this.nextOpenEnds.byTime) {
    this.nextOpenEnds.ends.sort(byTime ?
        // Sort creation date strings by descending time
        function (a, b) { return b[3].localeCompare(a[3]); } :
        // Sort by ascending path distance
        function (a, b) { return a[2] - b[2]; });
    this.nextOpenEnds.byTime = byTime;
  }

  var currentEnd = this.nextOpenEnds.ends.map(function (end) {
    return end[0] === treenode_id;
  }).indexOf(true);

  // Cycle through ends. If treenode_id was not in the end (such as when first
  // selecting an end), currentEnd will be -1, so the following line will make
  // it 0 and still produce the desired behavior.
  currentEnd = (currentEnd + 1) % this.nextOpenEnds.ends.length;

  var node = this.nextOpenEnds.ends[currentEnd];
  this.moveTo(node[1][2], node[1][1], node[1][0], this.selectNode.bind(this, node[0]));
};

/**
 * Sets treenode information as status. Can handle virtual nodes.
 */
SkeletonAnnotations.SVGOverlay.prototype.printTreenodeInfo = function(nodeID, prefixMessage) {
  if (this.isIDNull(nodeID)) return;
  var isReal = SkeletonAnnotations.isRealNode(nodeID);
  if (typeof prefixMessage === "undefined") {
    prefixMessage = isReal ? "Node " + nodeID : "Virtual node";
  }
  CATMAID.status(prefixMessage + " (loading authorship information)");

  // For a virtual node, the child information is displayed.
  if (!isReal) {
    nodeID = SkeletonAnnotations.getChildOfVirtualNode(nodeID);
  }

  var url = django_url + project.id + '/node/user-info';
  this.submit(url, {treenode_id: nodeID}, function(jso) {
      var msg = prefixMessage + " created by " + jso.user.first_name + " " +
          jso.user.last_name + " (" + jso.user.username + ") on " +
          jso.creation_time + ", last edited by " + jso.editor.first_name +
          " " + jso.editor.last_name + " (" + jso.editor.username + ") on " +
          jso.edition_time + ", reviewed by ";
      // Add review information
      if (jso.reviewers.length > 0) {
        var reviews = [];
        for (var i=0; i<jso.reviewers.length; ++i) {
          reviews.push(jso.reviewers[i].first_name + " " +
              jso.reviewers[i].last_name + " (" +
              jso.reviewers[i].username + ") on " + jso.review_times[i]);
        }
        msg += reviews.join(', ');
      } else {
        msg += "no one";
      }
      CATMAID.status(msg);
    },
    false,
    true);
};

/**
 * Create interpolated treenodes between the active node and the target click
 * site. If the shift key is pressed and a node from a different skeleton in
 * under the cursor when the mouse is clicked, an interpolated join is
 * performed. If the target node belongs to the same skeleton as the active
 * node, the target is merely selected. This function can deal with a virtual
 * active node and virtual target nodes.
 *
 * @param e The mouse event, to read out whether shift is down.
 */
SkeletonAnnotations.SVGOverlay.prototype.createInterpolatedTreenode = function(e) {
  // Check if there is already a node under the mouse
  // and if so, then activate it
  var atn = SkeletonAnnotations.atn;
  if (this.coords.lastX !== null && this.coords.lastY !== null) {
    // Radius of 7 pixels, in physical coordinates
    var respectVirtualNodes = true;
    var nearestnode = this.findNodeWithinRadius(this.coords.lastX,
       this.coords.lastY, 7, respectVirtualNodes);

    if (nearestnode !== null) {
      if (e && e.shiftKey) {
        // Shift down: interpolate and join
        if (null === atn.id) { return; }
        if (nearestnode.skeleton_id === atn.skeleton_id) {
          this.activateNode(nearestnode);
          return;
        }
        var nearestnode_id = nearestnode.id;
        var nearestnode_skid = nearestnode.skeleton_id;
        var atn_skid = atn.skeleton_id;
        var self = this;
        // Make sure the user has permissions to edit both the from and the to
        // skeleton.
        self.executeIfSkeletonEditable(atn_skid, function() {
          self.executeIfSkeletonEditable(nearestnode_skid, function() {
            // The function used to instruct the backend to do the merge
            var merge = function(annotations) {
              var phys_z = self.pix2physZ(self.stack.z, self.coords.lastY, self.coords.lastX);
              var phys_y = self.pix2physY(self.stack.z, self.coords.lastY, self.coords.lastX);
              var phys_x = self.pix2physX(self.stack.z, self.coords.lastY, self.coords.lastX);
              // Ask to join the two skeletons with interpolated nodes. Make
              // sure the nearest node is not virtual.
              self.promiseNode(nearestnode).then(function(toId) {
                self.createTreenodeLinkInterpolated(phys_x, phys_y, phys_z,
                  toId, annotations);
              });
            };

            // A method to use when the to-skeleton has multiple nodes
            var merge_multiple_nodes = function() {
            // Ask for merging
            // Get neuron name and id of the to-skeleton
            self.submit(
              django_url + project.id + '/skeleton/neuronnames',
              {skids: [nearestnode_skid]},
              function(json) {
                var from_model = SkeletonAnnotations.sourceView.createModel();
                var to_color = new THREE.Color().setRGB(1, 0, 1);
                var to_model = new SelectionTable.prototype.SkeletonModel(
                    nearestnode_skid, json[nearestnode_skid], to_color);
                var dialog = new SplitMergeDialog({
                  model1: from_model,
                  model2: to_model
                });
                dialog.onOK = function() {
                  // Get annotation set for the joined skeletons and merge both
                  merge(dialog.get_combined_annotation_set());
                };
                // Extend the display with the newly created line
                var extension = {};
                var p = self.nodes[SkeletonAnnotations.getActiveNodeId()],
                    c = self.nodes[nearestnode_id];
                extension[from_model.id] = [
                    new THREE.Vector3(self.pix2physX(p.z, p.y, p.x),
                                      self.pix2physY(p.z, p.y, p.x),
                                      self.pix2physZ(p.z, p.y, p.x)),
                    new THREE.Vector3(self.pix2physX(c.z, c.y, c.x),
                                      self.pix2physY(c.z, c.y, c.x),
                                      self.pix2physZ(c.z, c.y, c.x))
                ];
                dialog.show(extension);
              });
            };

            // A method to use when the to-skeleton has only a single node
            var merge_single_node = function() {
              /* Retrieve annotations for the to-skeleton and show th dialog if
               * there are some. Otherwise merge the single not without showing
               * the dialog.
               */
              NeuronAnnotations.retrieve_annotations_for_skeleton(
                  nearestnode_skid, function(to_annotations) {
                    if (to_annotations.length > 0) {
                      merge_multiple_nodes();
                    } else {
                      NeuronAnnotations.retrieve_annotations_for_skeleton(
                          atn.skeleton_id, function(from_annotations) {
                              merge(from_annotations.reduce(function(o, e) { o[e.name] = e.users[0].id; return o; }, {}));
                          });
                    }
                  });
            };

            /* If the to-node contains more than one node (or is virtual), show
             * the dialog.  Otherwise, check if the to-node contains
             * annotations. If so, show the dialog. Otherwise, merge it right
             * away and keep the from-annotations. Anyway, it has to be made
             * sure that the nearest node exists.
             */
            self.executeDependentOnExistence(nearestnode_id,
              self.executeDependentOnNodeCount.bind(self, nearestnode_id,
                merge_single_node, merge_multiple_nodes),
              merge_multiple_nodes);
          });
        });
        return;
      } else {
        // If shift is not down, just select the node:
        this.activateNode(nearestnode);
        return;
      }
    }
  }
  // Else, check that there is a node activated
  if (atn.id === null) {
    CATMAID.error('Need to activate a treenode first!');
    return;
  }

  var phys_x = this.pix2physX(this.stack.z, this.coords.lastY, this.coords.lastX);
  var phys_y = this.pix2physY(this.stack.z, this.coords.lastY, this.coords.lastX);
  var phys_z = this.pix2physZ(this.stack.z, this.coords.lastY, this.coords.lastX);

  this.createInterpolatedNode(phys_x, phys_y, phys_z, null, null);
};

/**
 * If you select a pre- or post-synaptic terminal, then run this command, the
 * active node will be switched to its connector (if one uniquely exists). If
 * you then run the command again, it will switch back to the terminal.
 */
SkeletonAnnotations.SVGOverlay.prototype.switchBetweenTerminalAndConnector = function() {
  var atn = SkeletonAnnotations.atn;
  if (null === atn.id) {
    CATMAID.info("A terminal must be selected in order to switch to its connector");
    return;
  }
  var ob = this.nodes[atn.id];
  if (!ob) {
    CATMAID.warn("Cannot switch between terminal and connector: node not loaded.");
    return;
  }
  if (SkeletonAnnotations.TYPE_CONNECTORNODE === ob.type &&
      SkeletonAnnotations.SUBTYPE_SYNAPTIC_CONNECTOR === ob.subtype) {
    if (this.switchingConnectorID === ob.id &&
        this.switchingTreenodeID in this.nodes) {
      // Switch back to the terminal
      this.moveToAndSelectNode(this.nodes[this.switchingTreenodeID].id);
    } else {
      // Go to the postsynaptic terminal if there is only one
      if (1 === Object.keys(ob.postgroup).length) {
        this.moveToAndSelectNode(this.nodes[Object.keys(ob.postgroup)[0]].id);
      // Otherwise, go to the presynaptic terminal if there is only one
      } else if (1 === Object.keys(ob.pregroup).length) {
        this.moveToAndSelectNode(this.nodes[Object.keys(ob.pregroup)[0]].id);
      } else {
        CATMAID.msg("Oops", "Don't know which terminal to switch to");
        return;
      }
    }
  } else if (SkeletonAnnotations.TYPE_NODE === ob.type) {
    if (this.switchingTreenodeID === ob.id &&
        this.switchingConnectorID in this.nodes) {
      // Switch back to the connector
      this.moveToAndSelectNode(this.nodes[this.switchingConnectorID].id);
    } else {
      // Find a connector for the treenode 'ob'
      var cs = this.findConnectors(ob.id);
      var preIDs = cs[0];
      var postIDs = cs[1];
      if (1 === postIDs.length) {
        this.switchingTreenodeID = ob.id;
        this.switchingConnectorID = postIDs[0];
      } else if (1 === preIDs.length) {
        this.switchingTreenodeID = ob.id;
        this.switchingConnectorID = preIDs[0];
      } else {
        CATMAID.msg("Oops", "Don't know which connector to switch to");
        this.switchingTreenodeID = null;
        this.switchingConnectorID = null;
        return;
      }
      this.moveToAndSelectNode(this.nodes[this.switchingConnectorID].id);
    }
  } else {
    CATMAID.error("Unknown node type: " + ob.type);
  }
};

/**
 * Delete a node with the given ID. The node can either be a connector or a
 * treenode.
 */
SkeletonAnnotations.SVGOverlay.prototype.deleteNode = function(nodeId) {
  var node = this.nodes[nodeId];
  var self = this;

  if (!node) {
    CATMAID.error("Could not find a node with id " + nodeId);
    return false;
  }

  if (!SkeletonAnnotations.isRealNode(nodeId)) {
    CATMAID.warn("Can't delete this node, because it is virtual");
    return false;
  }

  if (!mayEdit() || !node.can_edit) {
    if (node.type === SkeletonAnnotations.TYPE_CONNECTORNODE) {
      CATMAID.error("You don't have permission to delete connector #" + node.id);
    } else {
      CATMAID.error("You don't have permission to delete node #" + node.id);
    }
    return false;
  }

  // Unset active node to avoid actions that involve the deleted node
  var isActiveNode = (node.id === SkeletonAnnotations.getActiveNodeId());
  if (isActiveNode) {
    this.activateNode(null);
  }

  // Call actual delete methods defined below (which are callable due to
  // hoisting)
  switch (node.type) {
    case SkeletonAnnotations.TYPE_CONNECTORNODE:
      deleteConnectorNode(node);
      break;
    case SkeletonAnnotations.TYPE_NODE:
      deleteTreenode(node, isActiveNode);
      break;
  }

  /**
   * Delete the connector from the database and removes it from the current view
   * and local objects.
   */
  function deleteConnectorNode(connectornode) {
    self.submit(
        django_url + project.id + '/connector/delete',
        {pid: project.id,
        connector_id: connectornode.id},
        function(json) {
          connectornode.needsync = false;
          // If there was a presynaptic node, select it
          var preIDs  = Object.keys(connectornode.pregroup);
          var postIDs = Object.keys(connectornode.postgroup);
          if (preIDs.length > 0) {
              self.selectNode(preIDs[0]);
          } else if (postIDs.length > 0) {
              self.selectNode(postIDs[0]);
          } else {
              self.activateNode(null);
          }
          // capture ID prior to refreshing nodes and connectors
          var cID = connectornode.id;
          // Refresh all nodes in any case, to reflect the new state of the database
          self.updateNodes();

          CATMAID.statusBar.replaceLast("Deleted connector #" + cID);
        });
  }

  /**
   * Delete the node from the database and removes it from the current view and
   * local objects.
   */
  function deleteTreenode(node, wasActiveNode) {
    // Make sure all other pending tasks are done before the node is deleted.
    var delFn = CATMAID.neuronController.deleteTreenode.bind(
        CATMAID.neuronController, project.id, node.id);
    self.submit.then(delFn).then(function(json) {
      // nodes not refreshed yet: node still contains the properties of the deleted node
      // ensure the node, if it had any changes, these won't be pushed to the database: doesn't exist anymore
      node.needsync = false;
      // activate parent node when deleted
      if (wasActiveNode) {
        if (json.parent_id) {
          self.selectNode(json.parent_id);
        } else {
          // No parent. But if this node was postsynaptic or presynaptic
          // to a connector, the connector must be selected:
          var pp = self.findConnectors(node.id);
          // Try first connectors for which node is postsynaptic:
          if (pp[1].length > 0) {
            self.selectNode(pp[1][0]);
          // Then try connectors for which node is presynaptic
          } else if (pp[0].length > 0) {
            self.selectNode(pp[0][0]);
          } else {
            self.activateNode(null);
          }
        }
      }
      // Nodes are refreshed due to the change event the neuron controller emits
      CATMAID.statusBar.replaceLast("Deleted node #" + node.id);
    });
  }

  return true;
};

/**
 * Return true if the given node ID is part of the given skeleton. Expects the
 * node to be displayed.
 */
SkeletonAnnotations.SVGOverlay.prototype.nodeIsPartOfSkeleton = function(skeletonID, nodeID) {
  if (!this.nodes[nodeID]) throw new CATMAID.ValueError("Node not loaded");
  return this.nodes[nodeID].skeleton_id === skeletonID;
};

/**
 * Checks if the given skeleton is part of the current display and reloads all
 * nodes if this is the case.
 *
 * @param {number} skeletonID - The ID of the skelton changed.
 */
SkeletonAnnotations.SVGOverlay.prototype.handleChangedSkeleton = function(skeletonID) {
  this.updateIfKnown(skeletonID);
};

/**
 * Handles skeleton deletion events. Checks if the given skeleton is part of the
 * current display and reloads all nodes if this is the case.
 *
 * @param {number} skeletonID - The ID of the skelton changed.
 */
SkeletonAnnotations.SVGOverlay.prototype.handleDeletedSkeleton = function(skeletonID) {
  var activeSkeletonID = SkeletonAnnotations.getActiveSkeletonId();
  this.updateIfKnown(skeletonID, (function() {
    // Unselect active node, if it was part of the current display
    if (activeSkeletonID == skeletonID) {
      this.activateNode(null);
    }
  }).bind(this));
};

/**
 * Update nodes if the given skeleton is part of the current display.
 *
 * @param skeletonID {number} The ID of the skelton changed.
 * @param callback {function} An optional callback, executed after a node update
 */
SkeletonAnnotations.SVGOverlay.prototype.updateIfKnown = function(skeletonID, callback) {
  if (Object.keys(this.nodes).some(this.nodeIsPartOfSkeleton.bind(this, skeletonID))) {
    this.updateNodes(callback);
  }
};

/**
 * Interpolate and join, both: uses same function as createInterpolatedNode so
 * that requests are queued in the same queue.
 */
SkeletonAnnotations.SVGOverlay.prototype.createInterpolatedNode =
  SkeletonAnnotations.SVGOverlay.prototype.createInterpolatedNodeFn();

/**
 * Interpolate and join, both: uses same function as createInterpolatedNode so
 * that requests are queued in the same queue.
 */
SkeletonAnnotations.SVGOverlay.prototype.createTreenodeLinkInterpolated =
  SkeletonAnnotations.SVGOverlay.prototype.createInterpolatedNode;


/**
 * Manages the creation and deletion of tags via a tag editor DIV. If a tag
 * should be created on a virtual node, the virtual node is realized fist. From
 * http://blog.crazybeavers.se/wp-content/Demos/jquery.tag.editor
 */
SkeletonAnnotations.Tag = new (function() {
  this.tagbox = null;

  this.hasTagbox = function() {
    return this.tagbox !== null;
  };

  this.removeTagbox = function() {
    // Remove ATN change listener, if any
    SkeletonAnnotations.off(SkeletonAnnotations.EVENT_ACTIVE_NODE_CHANGED,
        this.handleATNChange);
    // Remove tag box, if any
    if (this.tagbox) {
      this.tagbox.remove();
      this.tagbox = null;
    }
  };

  this.tagATNwithLabel = function(label, svgOverlay, deleteExisting) {
    var atn = SkeletonAnnotations.atn;
    atn.promise().then(function(treenode_id) {
      svgOverlay.submit(
        django_url + project.id + '/label/' + atn.type + '/' + atn.id + '/update',
        {tags: label,
         delete_existing: deleteExisting ? true : false},
        function(json) {
          if ('' === label) {
            CATMAID.info('Tags removed.');
          } else {
            CATMAID.info('Tag ' + label + ' added.');
          }
          svgOverlay.updateNodes();
      });
    });
  };

  this.removeATNLabel = function(label, svgOverlay) {
    var atn = SkeletonAnnotations.atn;
    atn.promise().then(function(treenode_id) {
      svgOverlay.submit(
        django_url + project.id + '/label/' + atn.type + '/' + atn.id + '/remove',
        {tag: label},
        function(json) {
          CATMAID.info('Tag "' + label + '" removed.');
          svgOverlay.updateNodes();
        },
        undefined,
        undefined,
        function(err) {
          if ("ValueError" === err.type) {
            CATMAID.msg('Error', err.error ? err.error : "Unspecified");
          } else {
            CATMAID.error(err.error, err.detail);
          }
          return true;
        },
        true
      );
    });
  };

  this.handleATNChange = function(activeNode) {
    if (!activeNode || activeNode.id === null) {
      // If no node is active anymore, destroy the tag box.
      this.removeTagbox();
    }
  };

  this.handle_tagbox = function(atn, svgOverlay) {
    SkeletonAnnotations.atn.promise().then((function() {
      var atnID = SkeletonAnnotations.getActiveNodeId();
      var stack = project.getStack(atn.stack_id);
      var screenOrigin = stack.screenPosition();
      var screenPos = [
        stack.scale * (atn.x - screenOrigin.left),
        stack.scale * (atn.y - screenOrigin.top),
      ];
      this.tagbox = $("<div class='tagBox' id='tagBoxId" + atnID +
          "' style='z-index: 8; border: 1px solid #B3B2B2; padding: 5px; left: " +
          screenPos[0] + "px; top: " + screenPos[1] + "px;' />");
      this.tagbox.append("Tag: ");
      var input = $("<input id='Tags" + atnID + "' name='Tags' type='text' value='' />");
      this.tagbox.append(input).append("<div style='color:#949494'>(Save&Close: Enter)</div>");

      this.tagbox
        .css('background-color', 'white')
        .css('position', 'absolute')
        .appendTo("#" + svgOverlay.view.id)

        .mousedown(function (event) {
          if ("" === input.tagEditorGetTags()) {
            SkeletonAnnotations.Tag.updateTags(svgOverlay);
            SkeletonAnnotations.Tag.removeTagbox();
            CATMAID.info('Tags saved!');
            svgOverlay.updateNodes();
          }
          event.stopPropagation();
        })

        .keydown(function (event) {
          if (13 === event.keyCode) { // ENTER
            event.stopPropagation();
            if ("" === input.val()) {
              SkeletonAnnotations.Tag.updateTags(svgOverlay);
              SkeletonAnnotations.Tag.removeTagbox();
              CATMAID.info('Tags saved!');
              svgOverlay.updateNodes();
            }
          }
        })

        .keyup(function (event) {
          if (27 === event.keyCode) { // ESC
            event.stopPropagation();
            SkeletonAnnotations.Tag.removeTagbox();
          }
        });

      // Register to change events of active treenode
      SkeletonAnnotations.on(SkeletonAnnotations.EVENT_ACTIVE_NODE_CHANGED,
          this.handleATNChange, this);

      svgOverlay.submit(
          django_url + project.id + '/labels-for-node/' + atn.type  + '/' + atnID,
          {pid: project.id},
          function(json) {
            input.tagEditor({
              items: json,
              confirmRemoval: false,
              completeOnSeparator: true
            });
            input.focus();

            // TODO autocompletion should only be invoked after typing at least one character
            // add autocompletion, only request after tagbox creation
            svgOverlay.submit(
              django_url + project.id + '/labels-all',
              {pid: project.id},
              function(json) {
                input.autocomplete({source: json});
              });
          });
    }).bind(this));
  };

  this.updateTags = function(svgOverlay) {
    var atn = SkeletonAnnotations.atn;
    if (null === atn.id) {
      CATMAID.error("Can't update tags, because there is no active node selected.");
      return;
    }
    atn.promise().then(function() {
      svgOverlay.submit(
          django_url + project.id + '/label/' + atn.type + '/' + atn.id + '/update',
          {pid: project.id,
           tags: $("#Tags" + atn.id).tagEditorGetTags()},
          function(json) {});
    });
  };

  this.tagATN = function(svgOverlay) {
    var atn = SkeletonAnnotations.atn;
    if (null === atn.id) {
      alert("Select a node first!");
      return;
    }
    if (this.tagbox) {
      CATMAID.msg('BEWARE', 'Close tagbox first before you tag another node!');
      return;
    }
    if (svgOverlay.stack.z !== atn.z) {
      var self = this;
      svgOverlay.goToNode(atn.id,
          function() {
            self.handle_tagbox(atn, svgOverlay);
          });
    } else {
      this.handle_tagbox(atn, svgOverlay);
    }
  };
})();


var SplitMergeDialog = function(options) {
  var model1 = options.model1;
  var model2 = options.model2;

  // Models object
  this.models = {};
  this.models[model1.id] = model1;
  this.model1_id = model1.id;
  if (model2) {
    this.models[model2.id] = model2;
    this.model2_id = model2.id;
    this.in_merge_mode = true;
  } else {
    this.in_merge_mode = false;
    this.splitNodeId = options.splitNodeId;
    if (!this.splitNodeId) {
      CATMAID.error("Could not inititialize splitting dialog",
         "Please provide a split node ID!");
    }
  }
  // Basic dialog setup
  this.dialog = document.createElement('div');
  this.dialog.setAttribute("id", "skeleton-split-merge-dialog");
  if (this.in_merge_mode) {
    this.dialog.setAttribute("title", "Merge skeletons");
  } else {
    this.dialog.setAttribute("title", "Split skeleton");
  }
  // Dialog dimensions
  this.width = parseInt(CATMAID.UI.getFrameWidth() * 0.8);
  this.height = parseInt(CATMAID.UI.getFrameHeight() * 0.8);
};

SplitMergeDialog.prototype = {};

SplitMergeDialog.prototype.populate = function(extension) {
  var usable_height = this.height - 100;
  // Annotation list boxes
  var titleBig = document.createElement('div'),
      titleSmall = document.createElement('div'),
      colorBig = document.createElement('div'),
      colorSmall = document.createElement('div'),
      big = document.createElement('div'),
      small = document.createElement('div');

  big.setAttribute('id', 'split_merge_dialog_over_annotations');
  small.setAttribute('id', 'split_merge_dialog_under_annotations');

  // Style annotation list boxes
  big.setAttribute('multiple', 'multiple');
  small.setAttribute('multiple', 'multiple');

  big.style.width = '95%';
  big.style.height = usable_height * 0.45 + 'px';
  big.style.overflowY = 'scroll';
  big.style.marginBottom = usable_height * 0.05 + 'px';
  small.style.width = '95%';
  small.style.height = usable_height * 0.45 + 'px';
  small.style.overflowY = 'scroll';

  // Color boxes
  colorBig.style.width = '3%';
  colorBig.style.height = big.style.height;
  colorBig.style.cssFloat = 'left';
  colorBig.style.marginRight = '0.3em';
  colorSmall.style.width = '3%';
  colorSmall.style.height = small.style.height;
  colorSmall.style.cssFloat = 'left';
  colorSmall.style.marginRight = '0.3em';

  titleBig.style.padding = '0.1em';
  titleSmall.style.padding = '0.1em';

  var left = document.createElement('div'),
      right = document.createElement('div'),
      leftWidth = 250;

  // Position columns
  left.style.cssFloat = 'left';
  left.style.width = leftWidth + 'px';
  right.style.cssFloat = 'right';

  right.setAttribute('id', 'dialog-3d-view');
  right.style.backgroundColor = "#000000";

  // Layout left column
  left.appendChild(titleBig);
  left.appendChild(colorBig);
  left.appendChild(big);
  left.appendChild(colorSmall);
  left.appendChild(small);
  left.appendChild(titleSmall);

  this.dialog.appendChild(left);
  this.dialog.appendChild(right);

  var create_labeled_checkbox = function(annotation, annotator, checked, disabled, label) {
    var cb_label = document.createElement('label');
    cb_label.style.cssFloat = 'left';
    cb_label.style.clear = 'left';
    var cb = document.createElement('input');
    cb.checked = checked;
    cb.disabled = disabled;
    cb.setAttribute('class', 'split_skeleton_annotation');
    cb.setAttribute('annotation', annotation);
    cb.setAttribute('annotator', annotator);
    cb.setAttribute('type', 'checkbox');
    cb_label.appendChild(cb);
    // There should only be one user who has used this annotation
    // with the current neuron.
    cb_label.appendChild(document.createTextNode(label));

    return cb_label;
  };

  // Get all annotations for a skeleton and fill the list boxes
  var add_annotations_fn = function(skid, listboxes, disable_unpermitted) {
    NeuronAnnotations.retrieve_annotations_for_skeleton(skid,
        function(annotations) {
          // Create annotation check boxes
          annotations.forEach(function(aobj) {
            var create_cb = function(a_info, checked) {
              var disabled = false;
              // The front end shouldn't allow the removal of annotations one
              // hasn't permissions on in merge mode: If the current user has no
              // permission to change this annotation, check and disable this
              // checkbox.
              if (disable_unpermitted &&
                  a_info.users[0].id != session.userid &&
                  user_groups.indexOf(a_info.users[0].name) == -1 &&
                  !session.is_superuser) {
                checked = true;
                disabled = true;
              }
              return create_labeled_checkbox(a_info.name, a_info.users[0].id,
                  checked, disabled, a_info.name + ' (by ' + a_info.users[0].name + ')');
            };
            listboxes.forEach(function(lb) {
              lb.obj.appendChild(create_cb(aobj, lb.checked));
            });
          });
          // If there is no annotation, add a note
          var numAnnotations = listboxes.reduce(function(count, lb) {
            return count + lb.obj.childElementCount;
          }, 0);
          if (0 === numAnnotations) {
            var msg = "no annotations found";
            listboxes.forEach(function(lb) {
              lb.obj.appendChild(document.createTextNode(msg));
            });
          }
        });
    };

  // Create a 3D View that is not a SkeletonSource neither in an instance registry
  var W = function() {};
  W.prototype = WebGLApplication.prototype;
  this.webglapp = new W();
  this.webglapp.init(this.width - leftWidth - 50, usable_height,
      'dialog-3d-view'); // add to the right
  // Activate downstream shading in split mode
  if (!this.in_merge_mode) {
    this.webglapp.options.shading_method = 'active_node_split';
  }
  this.webglapp.look_at_active_node();
  // Add skeletons and do things depending on the success of this in a
  // callback function.
  this.webglapp.addSkeletons(this.models, (function() {
    if (this.in_merge_mode) {
      var skeleton = this.webglapp.space.content.skeletons[this.model1_id],
          skeleton2 = this.webglapp.space.content.skeletons[this.model2_id],
          count1 = skeleton.createArbor().countNodes(),
          count2 = skeleton2.createArbor().countNodes(),
          over_count, under_count, over_skeleton, under_skeleton;
      // Find larger skeleton
      if (count1 > count2) {
        this.over_model_id = this.model1_id;
        this.under_model_id = this.model2_id;
        over_count = count1;
        under_count = count2;
        over_skeleton = skeleton;
        under_skeleton = skeleton2;
      } else {
        this.over_model_id = this.model2_id;
        this.under_model_id = this.model1_id;
        over_count = count2;
        under_count = count1;
        over_skeleton = skeleton2;
        under_skeleton = skeleton;
      }
      // Update dialog title, name over count model first
      var over_name = this.models[this.over_model_id].baseName;
      var under_name = this.models[this.under_model_id].baseName;
      var title = 'Merge skeletons "' + over_name + '" and "' + under_name + '"';
      $(this.dialog).dialog('option', 'title', title);
      // Add titles
      titleBig.appendChild(document.createTextNode(over_count + " nodes"));
      titleBig.setAttribute('title', over_name);
      titleSmall.appendChild(document.createTextNode(under_count + " nodes"));
      titleSmall.setAttribute('title', under_name);
      // Color the small and big node count boxes
      colorBig.style.backgroundColor = '#' + over_skeleton.getActorColorAsHTMLHex();
      colorSmall.style.backgroundColor = '#' + under_skeleton.getActorColorAsHTMLHex();
      // Add annotation for name of neuron that gets joined into the other (i.e.
      // add name of model 2 to model 1). Don't check it, if it is named in the
      // default pattern "neuron 123456".
      var name = this.models[this.model2_id].baseName;
      var checked = (null === name.match(/neuron \d+/));
      var cb = create_labeled_checkbox(name, session.userid, checked, false,
          name + " (reference to merged in neuron)");
      if (count1 > count2) {
        big.appendChild(cb, checked);
      } else {
        small.appendChild(cb, checked);
      }
      // Add annotations
      add_annotations_fn(this.over_model_id, [{obj: big, checked: true}], true);
      add_annotations_fn(this.under_model_id, [{obj: small, checked: true}], true);
    } else {
      var skeleton = this.webglapp.space.content.skeletons[this.model1_id],
          arbor = skeleton.createArbor(),
          count1 = arbor.subArbor(this.splitNodeId).countNodes(),
          count2 = arbor.countNodes() - count1,
          over_count, under_count,
          model_name = this.models[this.model1_id].baseName;
      this.upstream_is_small = count1 > count2;
      if (this.upstream_is_small) {
        over_count = count1;
        under_count = count2;
        titleBig.setAttribute('title', "New");
        titleSmall.setAttribute('title', model_name);
      } else {
        over_count = count2;
        under_count = count1;
        titleBig.setAttribute('title', model_name);
        titleSmall.setAttribute('title', "New");
      }
      // Update dialog title
      var title = 'Split skeleton "' + model_name + '"';
      $(this.dialog).dialog('option', 'title', title);
      // Add titles
      titleBig.appendChild(document.createTextNode(over_count + " nodes"));
      titleSmall.appendChild(document.createTextNode(under_count + " nodes"));
      // Color the small and big node count boxes
      colorBig.style.backgroundColor = '#' + skeleton.getActorColorAsHTMLHex();
      var bc = this.webglapp.getSkeletonColor(this.model1_id);
      // Convert the big arbor color to 8 bit and weight it by 0.5. Since the 3D
      // viewer multiplies this weight by 0.9 and adds 0.1, we do the same.
      var sc_8bit = [bc.r, bc.g, bc.b].map(function(c) {
        return parseInt(c * 255 * 0.55);
      });
      colorSmall.style.backgroundColor = 'rgb(' + sc_8bit.join()  + ')';
      // Add annotations
      add_annotations_fn(this.model1_id,
          [{obj: big, checked: true}, {obj: small, checked: false}], false);
    }

    // Extend skeletons: Unfortunately, it is not possible right now to add new
    // points to existing meshes in THREE. Therefore, a new line is created.
    if (extension) {
      var pairs = extension[this.model1_id];
      if (pairs) {
        // Create new line representing interpolated link
        var geometry = new THREE.Geometry();
        pairs.forEach(function(v) {
          geometry.vertices.push(this.webglapp.space.toSpace(v.clone()));
        }, this);
        var material = new THREE.LineBasicMaterial({
          color: 0x00ff00,
          linewidth: 3,
        });
        skeleton.space.add(new THREE.Line(geometry, material, THREE.LinePieces));
        // Update view
        skeleton.space.render();
      }
    }
  }).bind(this));

  return this;
};

SplitMergeDialog.prototype.get_annotation_set = function(over) {
  var tag = over ? 'over' : 'under';
  var over_checkboxes = $(this.dialog).find('#split_merge_dialog_' +
      tag + '_annotations input[type=checkbox]').toArray();
  var annotations = over_checkboxes.reduce(function(o, cb) {
    // Create a list of objects, containing each the annotation an its
    // annotator ID.
    if (cb.checked) {
      o[$(cb).attr('annotation')] = parseInt($(cb).attr('annotator'));
    }
    return o;
  }, {});

  return annotations;
};

SplitMergeDialog.prototype.get_over_annotation_set = function() {
  return this.get_annotation_set(true);
};

SplitMergeDialog.prototype.get_under_annotation_set = function() {
  return this.get_annotation_set(false);
};

SplitMergeDialog.prototype.get_combined_annotation_set = function() {
  // Get both annotation sets
  var over_set = this.get_over_annotation_set();
  var under_set = this.get_under_annotation_set();
  // Combine both, avoid duplicates
  var combined_set = over_set;
  for (var a in under_set) {
    if (combined_set.hasOwnProperty(a)) {
      continue;
    }
    combined_set[a] = under_set[a];
  }

  return combined_set;
};

/**
 * The annotation distribution for a split is only valid if one part keeps the
 * whole set of annotations. This test verifies this agains the cached list of
 * annotations. One part keeps all annotations if all its checkboxes are
 * checked.
 */
SplitMergeDialog.prototype.check_split_annotations = function() {
  // Define a test function every checkbox should be tested against
  var checked_test = function(cb) {
    return cb.checked;
  };
  // Test over annotation set
  var $over_checkboxes = $(this.dialog).find(
      '#split_merge_dialog_over_annotations input[type=checkbox]');
  if ($over_checkboxes.toArray().every(checked_test)) {
    return true;
  }
  // Test under annotation set
  var $under_checkboxes = $(this.dialog).find(
      '#split_merge_dialog_under_annotations input[type=checkbox]');
  if ($under_checkboxes.toArray().every(checked_test)) {
    return true;
  }

  return false;
};

SplitMergeDialog.prototype.check_merge_annotations = function() {
  // At the moment, all combinations of annotations (even selecting none!) are
  // allowed. If a user is shown the dialog, (s)he can do whatever (s)he wants.
  return true;
};

SplitMergeDialog.prototype.show = function(extension) {
  var self = this;
  $(this.dialog).dialog({
    width: self.width,
    height: self.height,
    modal: true,
    close: function(ev, ui) {
      if (self.webglapp) {
        self.webglapp.space.destroy();
      }
      $(this).dialog("destroy");
    },
    buttons: {
      "Cancel": function() {
        $(this).dialog("close");
        if (self.onCancel) self.onCancel();
      },
      "OK": function() {
        if (self.in_merge_mode && !self.check_merge_annotations()) {
          alert("The selected annotation configuration isn't valid. " +
              "No annotation can be lost.");
        } else if (!self.in_merge_mode && !self.check_split_annotations()) {
          alert("The selected annotation configuration isn't valid. " +
              "One part has to keep all annotations.");
        } else {
          $(this).dialog("close");
          if (self.onOK) self.onOK();
        }
      }
    }
  });

  // The dialog is populated after creation, since the 3D viewer expects
  // elements to be added to the DOM.
  this.populate(extension);
};
