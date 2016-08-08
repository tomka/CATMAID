/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

  var LogTable = function() {
    /** Pointer to the existing instance of table. */
    this.logTable = null;

    var self = this;
    var asInitValsSyn = [];
  };

  /**
   * Redraw the complete log table.
   */
  LogTable.prototype.update = function() {
    this.logTable.fnClearTable( 0 );
    this.logTable.fnDraw();
  };

  LogTable.prototype.init = function (pid) {
    var tableid = '#logtable';
    var possibleLengths = CATMAID.pageLengthOptions;
    var possibleLengthsLabels = CATMAID.pageLengthLabels;

    self.logTable = $(tableid).dataTable({
      // http://www.datatables.net/usage/options
      "bDestroy": true,
      "sDom": '<"H"lr>t<"F"ip>',
      // default: <"H"lfr>t<"F"ip>
      "bProcessing": true,
      "bServerSide": true,
      "bAutoWidth": false,
      "iDisplayLength": possibleLengths[0],
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
              "value" : pid
          });
          aoData.push({
              "name": "operation_type",
              "value" : $('#logtable_operationtype').val()
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
          possibleLengths,
          possibleLengthsLabels
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

    $(tableid + " tbody").on('dblclick', 'tr', function () {
        var aData = self.logTable.fnGetData(this);
        // retrieve coordinates and moveTo
        var x = parseFloat(aData[3]);
        var y = parseFloat(aData[4]);
        var z = parseFloat(aData[5]);
        project.moveTo(z, y, x);
    });
  };

  // Export log table as singleton instance
  CATMAID.LogTable = new LogTable();

})(CATMAID);
