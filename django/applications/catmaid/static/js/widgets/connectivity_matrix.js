/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

  "use strict";

  var ConnectivityMatrixWidget = function() {
    this.widgetID = this.registerInstance();
    this.matrix = new CATMAID.ConnectivityMatrix();
    this.rowDimension = new CATMAID.BasicSkeletonSource(this.getName() + " Rows");
    this.colDimension = new CATMAID.BasicSkeletonSource(this.getName() + " Columns");
  };

  ConnectivityMatrixWidget.prototype = {};
  $.extend(ConnectivityMatrixWidget.prototype, new InstanceRegistry());

  // Make connectivity matrix widget available in CATMAID namespace
  CATMAID.ConnectivityMatrixWidget = ConnectivityMatrixWidget;

  /* Implement interfaces */

  ConnectivityMatrixWidget.prototype.getName = function()
  {
    return "Connectivity Matrix " + this.widgetID;
  };

  /**
   * Handle destruction of widget.
   */
  ConnectivityMatrixWidget.prototype.destroy = function() {
    NeuronNameService.getInstance().unregister(this);
    this.content = null;
    this.rowDimension.destroy();
    this.colDimension.destroy();
    this.unregisterInstance();
  };

  /* Non-interface methods */

  /**
   * Create an object with all relevant information for creating a CATMAID
   * widget. All methods can expect to be executed in the context of this
   * object.
   */
  ConnectivityMatrixWidget.prototype.getWidgetConfiguration = function() {
    return {
      class: 'connectivity_matrix',
      controlsID: 'connectivity_matrix_controls' + this.widgetID,
      contentID: 'connectivity_matrix' + this.widgetID,

      /**
       * Create widget controls.
       */
      createControls: function(controls) {
        // Create hidden select elements for row and column sources
        var rowSelect = CATMAID.skeletonListSources.createSelect(this.rowDimension);
        rowSelect.style.display = 'none';
        controls.appendChild(rowSelect);
        var colSelect = CATMAID.skeletonListSources.createSelect(this.colDimension);
        colSelect.style.display = 'none';
        controls.appendChild(colSelect);

        // This UI combines two skeleton source selects into one.
        controls.appendChild(document.createTextNode('From'));
        var sourceSelect = CATMAID.skeletonListSources.createSelect(this,
           [this.rowDimension.getName(), this.colDimension.getName()]);
        controls.appendChild(sourceSelect);
        sourceSelect.onchange = function() {
          rowSelect.value = this.value;
          colSelect.value = this.value;
        };

        // Indicates if loaded skeletons should be part of a group
        var loadAsGroup = false;

        /**
         * Load rows and/or coulmns and refresh.
         */
        var loadWith = function(withRows, withCols) {
          if (loadAsGroup) {
            // TODO: Get group name
            var groupName = "test";
            if (withRows) this.rowDimension.loadAsGroup(groupName);
            if (withCols) this.colDimension.loadAsGroup(groupName);
          } else {
            if (withRows) this.rowDimension.loadSource();
            if (withCols) this.colDimension.loadSource();
          }
          if (withRows || withCols) this.update();
        };

        var asGroupCb = document.createElement('input');
        asGroupCb.setAttribute('type', 'checkbox');
        asGroupCb.checked = loadAsGroup;
        asGroupCb.onclick = function() {
          loadAsGroup = this.checked;
        };
        var asGroup = document.createElement('label');
        asGroup.appendChild(asGroupCb);
        asGroup.appendChild(document.createTextNode('As group'));
        controls.appendChild(asGroup);

        var loadRows = document.createElement('input');
        loadRows.setAttribute("type", "button");
        loadRows.setAttribute("value", "Append rows");
        loadRows.onclick = loadWith.bind(this, true, false);
        controls.appendChild(loadRows);

        var loadColumns = document.createElement('input');
        loadColumns.setAttribute("type", "button");
        loadColumns.setAttribute("value", "Append columns");
        loadColumns.onclick = loadWith.bind(this, false, true);
        controls.appendChild(loadColumns);

        var loadAll = document.createElement('input');
        loadAll.setAttribute("type", "button");
        loadAll.setAttribute("value", "Append to both");
        loadAll.onclick = loadWith.bind(this, true, true);
        controls.appendChild(loadAll);

        var clear = document.createElement('input');
        clear.setAttribute("type", "button");
        clear.setAttribute("value", "Clear");
        clear.onclick = (function() {
          if (confirm("Do you really want to clear the current selection?")) {
            this.clear();
          }
        }).bind(this);
        controls.appendChild(clear);

        var update = document.createElement('input');
        update.setAttribute("type", "button");
        update.setAttribute("value", "Refresh");
        update.onclick = this.update.bind(this);
        controls.appendChild(update);
      },

      /**
       * Create widget content.
       */
      createContent: function(container) {
        this.content = container;
        this.update();
      }
    };
  };

  /**
   * Clear all sources.
   */
  ConnectivityMatrixWidget.prototype.clear = function() {
    this.rowDimension.clear();
    this.colDimension.clear();
    this.update();
  };

  /**
   * Update names of neurons in connectivity widget.
   */
  ConnectivityMatrixWidget.prototype.updateNeuronNames = function() {
    this.refresh();
  };

  /**
   * Refresh the UI without recreating the connectivity matrix.
   */
  ConnectivityMatrixWidget.prototype.refresh = function(container) {
    // Clrear container and add new table
    $(this.content).empty();
    this.addConnectivityMatrixTable(this.matrix, this.content);
  };

  /**
   * Recreate the connectivity matrix and refresh the UI.
   */
  ConnectivityMatrixWidget.prototype.update = function(container) {
    if (!this.matrix) {
      return;
    }

    // Clrear container
    var $content = $(this.content);
    $content.empty();

    var nRows = this.rowDimension.orderedSkeletonIDs.length;
    var nCols = this.colDimension.orderedSkeletonIDs.length;

    // If there are now row or column skeletons, display a message and return
    if (0 === nRows && 0 === nCols) {
      this.content.dataset.msg = "Please append row and column skeletons";
      return;
    } else if (0 === nRows) {
      this.content.dataset.msg = "Please append row skeletons, " + nCols +
          " column skeletons are already available.";
      return;
    } else if (0 === nCols) {
      this.content.dataset.msg = "Please append column skeletons, " + nRows +
          " row skeletons are already available.";
      return;
    } else {
      this.content.dataset.msg = "Please wait, connectivity information is retrieved.";
    }

    // Update connectivity matrix and make sure all currently looked at
    // skeletons are known to the neuron name service.
    var nns = NeuronNameService.getInstance();
    this.matrix.setRowSkeletonIDs(this.rowDimension.orderedSkeletonIDs);
    this.matrix.setColumnSkeletonIDs(this.colDimension.orderedSkeletonIDs);
    this.matrix.refresh()
      .then(nns.registerAll.bind(nns, this, this.rowDimension.getSelectedSkeletonModels()))
      .then(nns.registerAll.bind(nns, this, this.colDimension.getSelectedSkeletonModels()))
      .then((function() {
        // Clear any message
        if (this.content.dataset.msg) delete this.content.dataset.msg;
        // Create table
        this.addConnectivityMatrixTable(this.matrix, this.content);
      }).bind(this));
  };

  /**
   * Add a tabular representation of the connectivity matrix to the given DOM
   * element.
   *
   * @param {ConnectivityMatrix} The connectivity matrix to add.
   * @param {DOMElement} The element to add the table to.
   * @returns the content element passed in.
   */
  ConnectivityMatrixWidget.prototype.addConnectivityMatrixTable = function(
      matrix, content) {
    var nRows = matrix.getNumberOfRows();
    var nCols = matrix.getNumberOfColumns();
    if (0 === nRows || 0 === nCols) {
      return;
    }

    var m = matrix.get();
    var nns = NeuronNameService.getInstance();

    // Get group information
    var nDisplayRows = this.rowDimension.orderedElements.length;
    var nDisplayCols = this.colDimension.orderedElements.length;

    // Create table representation for connectivity matrix
    var table = document.createElement('table');
    table.setAttribute('class', 'partner_table');
    // Add column header, prepend one blank cell for row headers
    var colHeader = table.appendChild(document.createElement('tr'));
    colHeader.appendChild(document.createElement('th'));
    for (var c=0; c<nDisplayCols; ++c) {
      var id = this.colDimension.orderedElements[c];
      var isGroup = this.colDimension.groups[id];
      var name = isGroup ? id : nns.getName(id);
      var th = document.createElement('th');
      th.appendChild(document.createTextNode(name));
      th.setAttribute('colspan', 2);
      colHeader.appendChild(th);
    }
    // Add row headers and connectivity matrix rows
    for (var r=0; r<nDisplayRows; ++r) {
      var id = this.rowDimension.orderedElements[c];
      var isGroup = this.rowDimension.groups[id];
      var name = isGroup ? id : nns.getName(id);
      var rowSkid = this.rowDimension.orderedSkeletonIDs[r];
      var row = document.createElement('tr');
      table.appendChild(row);
      var th = document.createElement('th');
      th.appendChild(document.createTextNode(nns.getName(rowSkid)));
      row.appendChild(th);
      for (var c=0; c<nCols; ++c) {
        var colSkid = this.colDimension.orderedSkeletonIDs[c];
        var connections = m[r][c];
        var tdIn = createSynapseCountCell(rowSkid, colSkid, connections[0]);
        var tdOut = createSynapseCountCell(colSkid, rowSkid, connections[1]);
        row.appendChild(tdIn);
        row.appendChild(tdOut);
      }
    }
    content.appendChild(table);

    // Add a handler for openening connector selections for individual partners
    $('a[partnerID]', table).click(function () {
      var sourceID = $(this).attr('sourceID');
      var partnerID = $(this).attr('partnerID');
      if (sourceID && partnerID) {
        ConnectorSelection.show_shared_connectors(sourceID, [partnerID],
           "postsynaptic_to");
      } else {
        CATMAID.error("Could not find partner or source ID!");
      }

      return true;
    });

    return content;
  };

  /**
   * Create a synapse count table cell.
   */
  function createSynapseCountCell(sourceID, partnerID, count) {
    var td = document.createElement('td');
    td.setAttribute('class', 'syncount');
    if (count > 0) {
      // Create a links that will open a connector selection when clicked. The
      // handler to do this is created separate to only require one handler.
      var a = document.createElement('a');
      td.appendChild(a);
      a.appendChild(document.createTextNode(count));
      a.setAttribute('href', '#');
      a.setAttribute('sourceID', sourceID);
      a.setAttribute('partnerID', partnerID);
    } else {
      // Make a hidden span including the zero for semantic clarity and table exports.
      var s = document.createElement('span');
      td.appendChild(s);
      s.appendChild(document.createTextNode(count));
      s.style.display = 'none';
    }
    return td;
  }

})(CATMAID);
