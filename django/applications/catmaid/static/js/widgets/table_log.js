/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {


  var LogTable = function() {
    /** Pointer to the existing instance of table. */
    this.logTable = null;
    this.mode = "log";
  };

  LogTable.prototype.getName = function() {
    return "Log and history";
  };

  LogTable.prototype.getWidgetConfiguration = function() {
    return {
      controlsID: "log_table_controls",
      createControls: function(controls) {
        // Create tabs
        var tabs = CATMAID.DOM.addTabGroup(controls,
            'log_table_controls', ['Log', 'History']);

        var add = document.createElement('input');
        add.setAttribute("type", "button");
        add.setAttribute("id", "update_logtable");
        add.setAttribute("value", "Update table");
        add.onclick = this.update.bind(this);
        tabs['Log'].appendChild(add);
        tabs['Log'].dataset.mode = 'log';

        /* users */
        var sync = document.createElement('select');
        sync.setAttribute("id", "logtable_username");
        var option = document.createElement("option");
        option.text = "All";
        option.value = "All";
        sync.appendChild(option);
        option = document.createElement("option");
        option.text = "Team";
        option.value = "Team";
        sync.appendChild(option);
        var users = CATMAID.User.all();
        for (var userId in users) {
          var user = users[userId];
          var option = document.createElement("option");
          option.text = user.login + " (" + user.fullName + ")";
          option.value = user.id;
          sync.appendChild(option);
        }
        tabs['Log'].appendChild(sync);

        var opType = document.createElement('select');
        opType.setAttribute("id", "logtable_operationtype");
        var option = document.createElement("option");
        option.text = "All";
        option.value = -1;
        option.selected = option.defaultSelected = true;

        opType.appendChild(option);
        var operation_type_array = [
          "rename_root",
          "create_neuron",
          "rename_neuron",
          "remove_neuron",
          "move_neuron",

          "create_skeleton",
          "rename_skeleton",
          "remove_skeleton",
          "move_skeleton",

          "split_skeleton",
          "join_skeleton",
          "reroot_skeleton",

          "change_confidence",

          "reset_reviews"
        ];
        for( var i = 0; i < operation_type_array.length; i++ ) {
          var option = document.createElement("option");
            option.text = operation_type_array[i];
            option.value = operation_type_array[i];
            opType.appendChild(option);
        }
        tabs['Log'].appendChild(opType);

        // History table
        tabs['History'].dataset.mode = 'history';

        var updateHistory = document.createElement('input');
        updateHistory.setAttribute("type", "button");
        updateHistory.setAttribute("value", "Update history table");
        updateHistory.onclick = this.update.bind(this);
        tabs['History'].appendChild(updateHistory);

        var self = this;
        $(controls).tabs({
          activate: function(event, ui) {
            var mode = ui.newPanel.attr('data-mode');
            if (mode === 'log' || mode === 'history') {
              self.mode = mode;
              self.redraw();
            } else {
              CATMAID.warn('Unknown log table mode: ' + mode);
            }
          }
        });
      },
      contentID: "log_table_content",
      createContent: function(container) {
        var self = this;

        // Log table content
        this.logContainer = document.createElement('div');
        var logTable = document.createElement('table');
        logTable.setAttribute('id', 'logtable');

        logTable.innerHTML =
            '<thead>' +
            '<tr>' +
                '<th>user</th>' +
                '<th>operation</th>' +
                '<th>timestamp</th>' +
                '<th>x</th>' +
                '<th>y</th>' +
                '<th>z</th>' +
                '<th>freetext<input type="text" name="search_freetext" id="search_freetext" value="" class="search_init" /></th>' +
            '</tr>' +
            '</thead>' +
            '<tfoot>' +
            '<tr>' +
                '<th>user</th>' +
                '<th>operation</th>' +
                '<th>timestamp</th>' +
                '<th>x</th>' +
                '<th>y</th>' +
                '<th>z</th>' +
                '<th>freetext</th>' +
            '</tr>' +
            '</tfoot>';

        this.logContainer.appendChild(logTable);
        container.appendChild(this.logContainer);

        this.logTable = $(logTable).dataTable({
          // http://www.datatables.net/usage/options
          "bDestroy": true,
          "sDom": '<"H"lr>t<"F"ip>',
          // default: <"H"lfr>t<"F"ip>
          "bProcessing": true,
          "bServerSide": true,
          "bAutoWidth": false,
          "iDisplayLength": CATMAID.pageLengthOptions[0],
          "sAjaxSource": django_url + project.id + '/logs/list',
          "fnServerData": function (sSource, aoData, fnCallback) {
              var user_id = $('#logtable_username').val();
              if (!isNaN(user_id)) {
                  aoData.push({
                      name: "user_id",
                      value: user_id
                  });
              } else if (user_id === 'Team') {
                  aoData.push({
                      name: "whitelist",
                      value: true
                  });
              }
              aoData.push({
                  "name" : "pid",
                  "value" : project.id
              });
              aoData.push({
                  "name": "operation_type",
                  "value" : $('#logtable_operationtype').val() || -1
              });
              aoData.push({
                  "name": "search_freetext",
                  "value" : $('#search_freetext').val()
              });
              $.ajax({
                  "dataType": 'json',
                  "cache": false,
                  "type": "POST",
                  "url": sSource,
                  "data": aoData,
                  "success": fnCallback
              });
          },
          "aLengthMenu": [
            CATMAID.pageLengthOptions,
            CATMAID.pageLengthLabels
          ],
          "bJQueryUI": true,
          "aaSorting": [[ 2, "desc" ]],
          "aoColumns": [
              { // user
                  "bSearchable": false,
                  "bSortable": true
              },
              { // operation
                  "sClass": "center",
                  "bSearchable": false,
                  "bSortable": true
              },
              { // timestamp
                  "sClass": "center",
                  "bSearchable": false,
                  "bSortable": true
              },
              { // x
                  "sClass": "center",
                  "bSearchable": false,
                  "bSortable": false
              },
              { // y
                  "sClass": "center",
                  "bSearchable": false,
                  "bSortable": false
              },
              { // z
                  "sClass": "center",
                  "bSearchable": false,
                  "bSortable": false
              },
              { // freetext
                  "bSearchable": false,
                  "bSortable": false
              }
          ]
        });

        $(logTable).on('dblclick', 'tr', function () {
            var aData = self.logTable.fnGetData(this);
            // retrieve coordinates and moveTo
            var x = parseFloat(aData[3]);
            var y = parseFloat(aData[4]);
            var z = parseFloat(aData[5]);
            project.moveTo(z, y, x);
        });

        // History content
        this.historyContainer = document.createElement('div');
        var historyTable = document.createElement('table');
        this.historyTable = $(historyTable).DataTable({
          lengthMenu: [CATMAID.pageLengthOptions, CATMAID.pageLengthLabels],
          ajax: {
            url: CATMAID.makeURL(project.id +  "/transactions/"),
            dataSrc: ""
          },
          columns: [
            {data: "name"},
            {data: "comment"},
            {data: "user"},
            {data: "creation_time"},
            {data: "editor"},
            {data: "edition_time"}
          ],
        });
        this.historyContainer.appendChild(historyTable);
        container.appendChild(this.historyContainer);
      }
    };
  };

  /**
   * Redraw the complete log table.
   */
  LogTable.prototype.redraw = function() {
    if (this.mode === 'log') {
      this.logContainer.style.display = 'block';
      this.historyContainer.style.display = 'none';
    } else if (this.mode === 'history') {
      this.logContainer.style.display = 'none';
      this.historyContainer.style.display = 'block';
    }
  };

  /**
   * Update and redraw the complete log table.
   */
  LogTable.prototype.update = function() {
    if (this.mode === 'log') {
      this.logTable.fnClearTable( 0 );
      this.logTable.fnDraw();
    } else if (this.mode === 'history') {

    }
  };

  LogTable.prototype.init = function (pid) {
  };

  // Export log table as singleton instance
  CATMAID.LogTable = new LogTable();

  // Register widget with CATMAID
  CATMAID.registerWidget({
    key: "log-table",
    creator: LogTable
  });

})(CATMAID);
