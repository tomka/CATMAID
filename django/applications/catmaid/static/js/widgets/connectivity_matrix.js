/* -*- mode: espresso; espresso-indent-level: 4; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=4 shiftwidth=4 tabstop=4 expandtab: */

(function(CATMAID) {

  "use strict";

  /* UI configuration */

  var ConnectivityMatrixWidget = function() {
    this.widgetID = this.registerInstance();
    this.matrix = new CATMAID.ConnectivityMatrix();
  }

  ConnectivityMatrixWidget.prototype = {};
  $.extend(ConnectivityMatrixWidget.prototype, new InstanceRegistry());

  /* Implement interfaces */

  ConnectivityMatrixWidget.prototype.getName = function()
  {
    return "Connectivity Matrix " + this.widgetID;
  };

  ConnectivityMatrixWidget.prototype.destroy = function() {
    this.unregisterInstance();
  };

  ConnectivityMatrixWidget.prototype.append = function() {};
  ConnectivityMatrixWidget.prototype.clear = function(source_chain) {};
  ConnectivityMatrixWidget.prototype.removeSkeletons = function() {};
  ConnectivityMatrixWidget.prototype.updateModels = function() {};

  /* Non-interface methods */

  /**
   * Create an object with all relevant information for creating a CATMAID
   * widget. All methods can expect to be executed in the context of this
   * object.
   */
  ConnectivityMatrixWidget.prototype.getWidgetConfiguration = function() {
    return {
      controlsID: 'connectivity_matrix_controls' + this.widgetID,
      contentID: 'connectivity_matrix' + this.widgetID,

      /**
       * Create widget controls.
       */
      createControls: function(controls) {
        controls.appendChild(document.createTextNode('Vertical from'));
        controls.appendChild(SkeletonListSources.createSelect(this));

        controls.appendChild(document.createTextNode('Horizontal from'));
        controls.appendChild(SkeletonListSources.createSelect(this));

        var load = document.createElement('input');
        load.setAttribute("type", "button");
        load.setAttribute("value", "Append");
        //load.onclick = this.loadSource.bind(this);
        controls.appendChild(load);

        var clear = document.createElement('input');
        clear.setAttribute("type", "button");
        clear.setAttribute("value", "Clear");
        clear.onclick = function() {
          if (confirm("Do you really want to clear the current selection?")) {
            this.clear();
          }
        };
        controls.appendChild(clear);

        var update = document.createElement('input');
        update.setAttribute("type", "button");
        update.setAttribute("value", "Refresh");
        update.onclick = this.refresh.bind(this);
        controls.appendChild(update);
      },

      /**
       * Create widget content.
       */
      createContent: function(container) {

      },

      /**
       * Handle destruction of widget.
       */
      destroy: function() {
        this.destroy();
      },
    }
  };


})(CATMAID);
