/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

  "use strict";

  /**
   * The neuron controler provides access to several back-end API functions
   * concerning neurons (e.g. deleting neurons and treenodes). It provides
   * multiple events that one can register to.
   */
  var NeuronController = function() {
    this.EVENT_SKELETON_DELETED = "neuron_manager_skeleton_deleted";
    this.EVENT_SKELETON_CHANGED = "neuron_manager_skeleton_changed";
  };

  NeuronController.prototype = {};
  Events.extend(NeuronController.prototype);

  /**
   * Delete a neuron and the skeleton is is modeled by.
   *
   * @param {number} projectID - The ID of the project the neuron is part of.
   * @param {number} neuronID - The ID of the neuron to delete.
   * @returns promise deleting the skeleton and neuron
   */
  NeuronController.prototype.deleteNeuron = function(projectID, neuronID) {
    return new Promise((function(resolve, reject) {
      // Try to delete neuron
      var url = CATMAID.makeURL(projectID + '/neuron/' + neuronID + '/delete');
      requestQueue.register(url, 'GET', {}, CATMAID.jsonResponseHandler(
            (function(json) {
              resolve(json);
              // Emit deletion event for every deleted skeleton
              json.skeleton_ids.forEach(function(skid) {
                this.trigger(this.EVENT_SKELETON_DELETED, skid);
              }, this);
            }).bind(this),
            reject));
    }).bind(this));
  };

  /**
   * Delete a treenode.
   *
   * @param {number} projectID - The project the treenode is part of.
   * @param {number} treenodeID - The treenode to delete.
   * @returns promise deleting the treenode
   */
  NeuronController.prototype.deleteTreenode = function(projectID, nodeID) {
    return new Promise((function(resolve, reject) {
      var url = CATMAID.makeURL(projectID + '/treenode/delete');
      requestQueue.register(url, 'POST',
        {
          pid: projectID,
          treenode_id: nodeID
        },
        CATMAID.jsonResponseHandler(
          (function(json) {
            resolve(json);
            // Emit deletion event, if the last node was removed and the neuron
            // deleted. Otherwise, trigger a change event for the neuron.
            var neuron_id = null;
            if (json.deleted_neuron) {
              this.trigger(this.EVENT_SKELETON_DELETED, json.skeleton_id);
            } else {
              this.trigger(this.EVENT_SKELETON_CHANGED, json.skeleton_id);
            }
          }).bind(this),
          reject));
    }).bind(this));
  };

  /**
   * Join two skeletons.
   */
  NeuronController.prototype.joinNeurons = function(projectID, fromSkeletonID,
      toSkeletonID, annotationSet) {
    return new Promise(function(resolve, reject) {
        django_url + project.id + '/skeleton/join',
        {
          from_id: fromid,
          to_id: toid,
          annotation_set: JSON.stringify(annotation_set),
        }
    });
  };

  // Create a singleton instance
  CATMAID.neuronController = new NeuronController();

})(CATMAID);
