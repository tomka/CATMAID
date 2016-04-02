/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

  "use strict";

  /**
   * Some back-end functions require a user to send a state along (e.g. node
   * removal or creation). In a collaborative environment, clients can never be
   * sure if the information they see is the most recent one. The back-end
   * required to make changes off of the most recent version. To represent the
   * (local) state the client sees the world in, the state generating functions
   * are used. There is a NodeState and a ParentState where the last one is a
   * subset of the first one, representing only the parent information of a node
   * (used e.g. for node creation). Then there is also NoCheckState, which
   * causes the back-end to disable state checking for a request.
   */

  /**
   * A general state representation for the neighborhood of an existing nodes.
   *
   * {
   *   parent: (<id>, <edition_time>),
   *   children: ((<child_id>, <child_edition_time>), ...),
   *   links: ((<connector_id>, <connector_edition_time>, <relation_id>), ...)
   * }
   */
  CATMAID.getNeighborhoodState = function(nodeId, editionTime, parentId, parentEditTime,
      children, links) {
    var state = {
      "edition_time": editionTime,
      "parent": [parentId, parentEditTime],
      "children": children,
      "links": links,
    };
    return JSON.stringify(state);
  };

  /**
   * A state representation for new nodes.
   */
  CATMAID.getNodeState = function(nodeId, editionTime) {
    var state = {
      "node": [nodeId, editionTime]
    };
    return JSON.stringify(state);
  };

  /**
   * A state representation for new multiple nodes.
   */
  CATMAID.getMultiNodeState = function(editionTimes) {
    var state = [];
    for (var nodeId in editionTimes) {
      state.push([nodeId, editionTimes[nodeId]]);
    }
    return JSON.stringify(state);
  };

  /**
   * A state representation for new nodes.
   */
  CATMAID.getParentState = function(parentId, parentEditTime) {
    var state = {
      // Make sure root nodes get represented properly
      "parent": [parentId || -1, parentEditTime || ""]
    };
    return JSON.stringify(state);
  };

  /**
   * A state to represent parent and child edition time.
   */
  CATMAID.getEdgeState = function(parentId, parentEditTime, childId, childEditTime) {
    var state = {
      "parent": [parentId, parentEditTime],
      "children": [[childId, childEditTime]]
    };
    return JSON.stringify(state);
  };

  /**
   * A dummy state that causes the back-end to not do state checks.
   */
  CATMAID.getNoCheckState = function() {
    var state = {
      "nocheck": true
    };
    return JSON.stringify(state);
  };

  var testNoCheckState = CATMAID.getNoCheckState();
  CATMAID.isNoCheckState = function(state) {
    return testNoCheckState == state;
  };

  var get_or_error = function(obj, field) {
    if (obj[field]) {
      return obj[field];
    }
    throw new CATMAID.ValueError("Couldn't read field \"" +
        field + "\" for state initialization");
  };

  /**
   * A generic state doesn't manage nodes itself, but delegates to functions
   * passed in as parameter on construction. These functions are expected to
   * return a two-element list for each node: [id, edition_time].
   */
  var GenericState = function(options) {
    this.getNode = get_or_error(options, 'getNode');
    this.getParent = get_or_error(options, 'getParent');
    this.getChildren = get_or_error(options, 'getChildren');
    this.getLinks = get_or_error(options, 'getLinks');
  };

  GenericState.prototype.makeNodeState = function(nodeId) {
    var node = this.getNode(nodeId);
    if (!node) {
      throw new CATMAID.ValueError("Couldn't find node " + nodeId + " in state");
    }
    return CATMAID.getNodeState(node[0], node[1]);
  };

  GenericState.prototype.makeParentState = function(nodeId) {
    var parent;
    if (nodeId) {
      parent = this.getNode(nodeId);
      if (!parent) {
        throw new CATMAID.ValueError("Couldn't find node " + nodeId + " in state");
      }
    } else {
      // If no node ID is passed in, a "no parent" state is created
      parent = [-1, ""];
    }
    return CATMAID.getParentState(parent[0], parent[1]);
  };

  GenericState.prototype.makeEdgeState = function(nodeId, parentId) {
    var node = this.getNode(nodeId);
    var parent = this.getNode(parentId);
    if (!node) {
      throw new CATMAID.ValueError("Couldn't find node " + nodeId + " in state");
    }
    if (!parent) {
      throw new CATMAID.ValueError("Couldn't find parent node " + nodeId + " in state");
    }
    return CATMAID.getEdgeState(parent[0], parent[1], node[0], node[1]);
  };

  GenericState.prototype.makeNeighborhoodState = function(nodeId) {
    var node = this.getNode(nodeId);
    var parent = this.getParent(nodeId);
    if (!node) {
      throw new CATMAID.ValueError("Couldn't find node " + nodeId + " in state");
    }
    if (!parent) {
      throw new CATMAID.ValueError("Couldn't find parent of node " + nodeId + " in state");
    }
    return CATMAID.getNeighborhoodState(node[0], node[1], parent[0], parent[1],
        this.getChildren(nodeId), this.getLinks(nodeId));
  };

  CATMAID.GenericState = GenericState;


  /**
   * This state represents only a local node centered part. If passed in, node
   * and parent are expected to be two-element lists with ID and edition time.
   * Children and links are expected to be lists of such two-element lists.
   * There is no extra check performed whether the passed in data is correct.
   */
  var LocalState = function(node, parent, children, links) {
    this.node = node;
    this.parent = parent;
    this.children = children;
    this.links = links;
    this.nodes = {};
  };

  LocalState.prototype = Object.create(GenericState.prototype);
  LocalState.constructor = LocalState;

  LocalState.prototype.getNode = function(nodeId) {
    return (this.node && this.node[0] == nodeId) ? this.node : undefined;
  };

  LocalState.prototype.makeParentState = function(nodeId) {
    if (!this.parent) {
      throw new CATMAID.ValueError("Couldn't find node " + nodeId + " to create parent state");
    }
    return CATMAID.getParentState(this.parent[0], this.parent[1]);
  };

  LocalState.prototype.getParent = function(nodeId) {
    return this.parent;
  };

  LocalState.prototype.getChildren = function(nodeId) {
    return this.children;
  };

  LocalState.prototype.getLinks = function(nodeId) {
    return this.links;
  };

  // Export local state
  CATMAID.LocalState = LocalState;

  // A function to return undefined, just to be explicit.
  function returnUndefined() {}

  /**
   * A no-check implementation returns undefined for all nodes and the created
   * state serializations trigger the back-end to disable state checking.
   */
  var NoCheckState = function() {};
  NoCheckState.prototype.getNode = returnUndefined;
  NoCheckState.prototype.getParent = returnUndefined;
  NoCheckState.prototype.getChildren = returnUndefined;
  NoCheckState.prototype.getLinks = returnUndefined;
  NoCheckState.prototype.makeNodeState = CATMAID.getNoCheckState;
  NoCheckState.prototype.makeParentState = CATMAID.getNoCheckState;
  NoCheckState.prototype.makeEdgeState = CATMAID.getNoCheckState;
  NoCheckState.prototype.makeNeighborhoodState = CATMAID.getNoCheckState;

  // Export no-check state
  CATMAID.NoCheckState = NoCheckState;

})(CATMAID);
