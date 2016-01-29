/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

  "use strict";

  /**
   * This namespace provides functions to work with annotations on neurons. All
   * of them return promises.
   */
  var Nodes = {

    /**
     * Update the radius of a node.
     *
     * @returns A new promise that is resolved once the radius is updated.
     */
    updateRadius: function(projectId, nodeId, radius, updateMode) {
      CATMAID.requirePermission(projectId, 'can_annotate',
          'You don\'t have have permission to update the radius of a node');
      var url = CATMAID.makeURL(projectId + '/treenode/' + nodeId + '/radius');
      var params = {
        radius: radius,
        option: updateMode
      };

      return CATMAID.fetch(url, 'POST', params).then(function(json) {
        return {
          // An object mapping node IDs to their old (!) radius is returned.
          'updatedNodes': json.updated_nodes
        };
      });
    }

  };

  // Export nodes
  CATMAID.Nodes = Nodes;

  CATMAID.UpdateNodeRadiusCommand = CATMAID.makeCommand(function(projectId,
        nodeId, radius, updateMode) {

    var exec = function(done, command) {
      var updateRadius = CATMAID.Nodes.updateRadius(projectId, nodeId,
          radius, updateMode);

      return updateRadius.then(function(result) {

        // The returned updatedNodes list contains objects with a node id and
        // the old radius.
        command._updatedNodes = result.updatedNodes;
        done();
        return result;
      });
    };

    var undo = function(done, command) {
      // Fail if expected undo parameters are not available from command
      if (undefined === command._updatedNodes) {
        throw new CATMAID.ValueError('Can\'t undo radius update, history data not available');
      }
      var updateRadius = CATMAID.Nodes.updateRadius(projectId, nodeId,
          radius, updateMode);

      // Build one promise for each node and return a super promise that
      // resolves once all removal promises are resolved.
      var promises = command._updatedNodes.map(function(nodeUpdate) {
        var updateMode = 0; // Only update single nodes
        return CATMAID.Nodes.updateRadius(projectId, nodeUpdate.nodeId,
            nodeUpdate.oldRadius, updateMode);
      });
      return Promise.all(promises).then(done);
    };

    var info = "Update radius of node " + nodeId + " to be " + radius + "nm");
    this.init(info, exec, undo);
  });

})(CATMAID);
