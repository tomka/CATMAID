/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */
/* global
  project,
  requestQueue,
*/

(function(CATMAID) {

  "use strict";

  var UserAnalytics = function() {};

  UserAnalytics.prototype.getName = function() {
    return "User Analytics";
  };

  UserAnalytics.prototype.getWidgetConfiguration = function() {
    return {
      controlsID: "user-analytics-controls",
      createControls: function(controls) {
        var userSelectLabel = document.createElement('label');
        userSelectLabel.appendChild(document.createTextNode('User'));
        var userSelect = document.createElement('select');
        userSelect.setAttribute('data-name', 'user');
        var users = CATMAID.User.all();
        var sortedUserIds = CATMAID.User.sortedIds();
        for (var i=0; i < sortedUserIds.length; ++i) {
          var user = users[sortedUserIds[i]];
          if (!user) {
            throw new CATMAID.ValueError('Couldn\'t find user with ID ' + sortedUserIds[i]);
          }
          if (user.isAnonymous) {
            continue;
          }
          var name = user.fullName ? user.fullName : user.login;
          var selected = (user.id == CATMAID.session.userid);
          var option = new Option(name, user.id, selected, selected);
          userSelect.add(option);
        }
        userSelectLabel.appendChild(userSelect);

        var startDateLabel = document.createElement('label');
        startDateLabel.appendChild(document.createTextNode('Start date'));
        var startDate = document.createElement('input');
        startDate.setAttribute('type', 'text');
        startDate.setAttribute('data-name', 'start_date');
        startDateLabel.appendChild(startDate);

        var endDateLabel = document.createElement('label');
        endDateLabel.appendChild(document.createTextNode('End date'));
        var endDate = document.createElement('input');
        endDate.setAttribute('type', 'text');
        endDate.setAttribute('data-name', 'end_date');
        endDateLabel.appendChild(endDate);

        var refresh = document.createElement('input');
        refresh.setAttribute('type', 'button');
        refresh.setAttribute('value', 'Refresh');
        refresh.onclick = this.refresh.bind(this);

        controls.appendChild(userSelectLabel);
        controls.appendChild(startDateLabel);
        controls.appendChild(endDateLabel);
        controls.appendChild(refresh);
      },
      contentID: "user-analytics-content",
      createContent: function(content) {
        var img = document.createElement('img');
        img.src = CATMAID.makeURL('useranalytics');
        img.setAttribute('data-name', "useranalyticsimg");
        content.appendChild(img);
      },
      init: function() {

        // Autocompletion for user selection
        $('#user-analytics-controls select[data-name=user]')
            .combobox();

        // Init date fields
        $('#user-analytics-controls input[data-name=start_date]')
          .datepicker({ dateFormat: "yy-mm-dd", defaultDate: -10 })
          .datepicker('setDate', "-10");
        $('#user-analytics-controls input[data-name=end_date]')
          .datepicker({ dateFormat: "yy-mm-dd", defaultDate: 0 })
          .datepicker('setDate', "0");
      }
    };
  };

  /**
   * Refresh the content of this widget based on the current settings.
   */
  UserAnalytics.prototype.refresh = function() {
    $.blockUI();
    try {
      var userSelect = document.querySelector('#user-analytics-controls select[data-name=user]');
      var startInput = document.querySelector('#user-analytics-controls input[data-name=start_date]');
      var endInput = document.querySelector('#user-analytics-controls input[data-name=end_date]');
      var start = startInput.value,
          end = endInput.value,
          userId = userSelect.value,
          project_id = project.id;

      var img = document.querySelector('#user-analytics-content img[data-name=useranalyticsimg]');
      img.src = CATMAID.makeURL('useranalytics' + "?userid=" + userId +
          '&project_id=' + project_id) + "&start=" + start + "&end=" + end;
    } catch (e) {
      CATMAID.error(e);
      console.log(e, e.stack);
    }
    $.unblockUI();
  };


  // Export statistics widget
  CATMAID.UserAnalytics = UserAnalytics;

  // Register widget with CATMAID
  CATMAID.registerWidget({
    key: "user-analytics",
    creator: UserAnalytics
  });

})(CATMAID);
