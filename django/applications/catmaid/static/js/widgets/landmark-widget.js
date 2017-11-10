/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

  "use strict";

  /**
   * Create a new Landmark Widget, optional with a set of initial landmark
   * groups. The widget allows to create landmarks, landmark groups and link
   * both to points in project space.
   */
  var LandmarkWidget = function(options)
  {
    this.widgetID = this.registerInstance();
    this.idPrefix = `landmark-widget${this.widgetID}-`;

    // The displayed data table
    this.landmarkTable = null;

    // Data caches
    this.landmarks = null;
    this.landmarkIndex = null;
    this.landmarkGroups = null;

    // The set of currently selected landmark groups, acts as filter for
    // landmark table.
    this.selectedLandmarkGroups = new Set();

    // The current edit mode
    this.mode = 'landmarks';
    this.modes = ['landmarks'];
  };

  LandmarkWidget.prototype = {};
  $.extend(LandmarkWidget.prototype, new InstanceRegistry());

  LandmarkWidget.prototype.getName = function() {
    return "Landmarks " + this.widgetID;
  };

  LandmarkWidget.prototype.destroy = function() {
    this.unregisterInstance();
  };

  LandmarkWidget.prototype.getWidgetConfiguration = function() {
    return {
      controlsID: this.idPrefix + 'controls',
      createControls: function(controls) {
        var self = this;
        var tabNames = this.modes.map(function(m) {
          return LandmarkWidget.MODES[m].title;
        }, this);
        var tabs = CATMAID.DOM.addTabGroup(controls, '-landmarks', tabNames);
        this.modes.forEach(function(mode, i) {
          var mode = LandmarkWidget.MODES[mode];
          var tab = tabs[mode.title];
          CATMAID.DOM.appendToTab(tab, mode.createControls(this));
          tab.dataset.index = i;
        }, this);
        this.tabControls = $(controls).tabs({
          active: this.modes.indexOf(this.mode),
          activate: function(event, ui) {
            var oldStepIndex = parseInt(ui.oldPanel.attr('data-index'), 10);
            var newStepIndex = parseInt(ui.newPanel.attr('data-index'), 10);

            var tabs = $(self.tabControls);
            var activeIndex = tabs.tabs('option', 'active');
            if (activeIndex !== self.modes.indexOf(self.mode)) {
              if (!self.setMode(self.modes[activeIndex])) {
                // Return to old tab if selection was unsuccessful
                if (oldStepIndex !== newStepIndex) {
                  $(event.target).tabs('option', 'active', oldStepIndex);
                }
              }
              self.update();
            }
          }
        });
      },
      contentID: this.idPrefix + 'content',
      createContent: function(content) {
        this.content = content;
      },
      init: function() {
        this.update();
      },
      helpText: [
        '<p>Landmarks are semantic entities that describe a particular ',
        'location in a dataset. As a concept it can be found in different ',
        'data sets or even at differentlocations within one dataset.</p>'
      ].join('\n')
    };
  };

  LandmarkWidget.prototype.reload = function() {
    
  };

  LandmarkWidget.prototype.update = function() {
    // Clear content
    while (this.content.lastChild) {
      this.content.removeChild(this.content.lastChild);
    }
    var tabs = $(this.tabControls);
    var activeIndex = tabs.tabs('option', 'active');
    var widgetIndex = this.modes.indexOf(this.mode);
    if (activeIndex !== widgetIndex) {
      tabs.tabs('option', 'active', widgetIndex);
    }

    // Update actual content
    let mode = LandmarkWidget.MODES[this.mode];
    mode.createContent(this.content, this);
  };

  LandmarkWidget.prototype.setMode = function(mode) {
    var index = this.modes.indexOf(mode);
    if (index === -1) {
      throw new CATMAID.ValueError('Unknown Landmark Widget mode: ' + mode);
    }
    this.mode = mode;
    this.update();
    return true;
  };

  /**
   * Select a landmark and display all linked locations below the landmark
   * table, if Semantic mode is active.
   */
  LandmarkWidget.prototype.selectLandmark = function(landmarkId) {
    if (this.mode === 'landmarks') {
      
    }
  };

  function locationIndexToString(i) {
    let displayIndex = i + 1;
    /* jshint validthis: true */
    return '<a href="#" class="bordered-list-elem" data-id="' + this.id +
        '" data-action="select-location" data-index="' + i + '">' + displayIndex + '</a>';
  }

  function wrapInGroupEditLink(e) {
    return '<a href="#" data-action="edit-group-members">' + e + '</a>';
  }

  /**
   * If the respective landmark is available from already retrieved data return
   * the landmark's name, otherwise return its ID.
   */
  LandmarkWidget.prototype.groupedLandmarkToString = function(group, landmarkId) {
    if (this.landmarkIndex && this.landmarkGroupIndex) {
      let landmark = this.landmarkIndex.get(landmarkId);
      if (landmark) {
        // These are the possible locations, the ones linked to the landmark
        // itself. Based on this we can find the group linked locations.
        let groupLocations = group.locations;
        let linkedLocations = [];
        for (let i=0, imax=landmark.locations.length; i<imax; ++i) {
          // Check if the landmark location is a member of this group
          var loc = landmark.locations[i];
          var isMember = false;
          for (var j=0, jmax=groupLocations.length; j<jmax; ++j) {
            let groupLocation = groupLocations[j];
            if (groupLocation.id == loc.id) {
              linkedLocations.push(i);
              break;
            }
          }
        }
        let linkedLocationsRepr = linkedLocations.map(locationIndexToString, landmark);
        if (linkedLocationsRepr.length > 0) {
          return wrapInGroupEditLink(landmark.name) + " (" + linkedLocationsRepr.join("") + ")";
        } else {
          return wrapInGroupEditLink(landmark.name) + " (-)";
        }
      } else {
        return wrapInGroupEditLink(landmark.id);
      }
    } else {
      return wrapInGroupEditLink(landmarkId);
    }
  };

  function addToIdIndex(index, element) {
    index.set(element.id, element);
    return index;
  }

  function addLandmarkGroupMembership(index, landmarkGroup) {
    let members = landmarkGroup.members;
    for (var i=0, imax=members.length; i<imax; ++i) {
      let landmarkId = members[i];
      let groups = index.get(landmarkId);
      if (!groups) {
        groups = [];
        index.set(landmarkId, groups);
      }
      groups.push(landmarkGroup.id);
    }
    return index;
  }

  LandmarkWidget.prototype.updateLandmarks = function() {
    var self = this;
    return CATMAID.fetch(project.id +  "/landmarks/", "GET", {
        with_locations: true
      })
      .then(function(result) {
        self.landmarks = result;
        self.landmarkIndex = result.reduce(addToIdIndex, new Map());
        return result;
      });
  };

  LandmarkWidget.prototype.updateLandmarkGroups = function() {
    var self = this;
    return CATMAID.fetch(project.id +  "/landmarks/groups/", "GET", {
        with_members: true,
        with_locations: true
      })
      .then(function(result) {
        self.landmarkGroups = result;
        self.landmarkGroupMemberships = result.reduce(addLandmarkGroupMembership, new Map());
        self.landmarkGroupIndex = result.reduce(addToIdIndex, new Map());
        return result;
      });
  };

  /**
   * Return a promise that will either resolve with a new selection of group
   * members.
   */
  LandmarkWidget.prototype.editGroupMembers = function(landmarkGroup) {
    var prepare = this.landmarks ? Promise.resolve(this.landmarks) :
        this.updateLandmarks();
    return prepare
      .then(function(landmarks) {
        return new Promise(function(resolve, reject) {
          // Show a checkbox select widget
          let options = landmarks.map(function(lm) {
            return {
              title: lm.name,
              value: lm.id
            };
          });
          var dialog = new CATMAID.OptionsDialog("Edit group membership");
          dialog.appendMessage("Select all landmarks that should be part of " +
            "landmark group \"" + landmarkGroup.name + "\" (" +
            landmarkGroup.id + ").");
          var memberPanel = CATMAID.DOM.createCheckboxSelectPanel(options,
              landmarkGroup.members, true);
          dialog.appendChild(memberPanel);
          dialog.onOK = function() {
            var selectedLandmarkInputs = memberPanel.querySelectorAll('input[type=checkbox]');
            var selectedLandmarks = [];
            selectedLandmarkInputs.forEach(function(elem) {
              if (elem.checked) {
                selectedLandmarks.push(parseInt(elem.value, 10));
              }
            });
            resolve(selectedLandmarks);
          };
          dialog.onCancel = function() {
            resolve(null);
          };

          dialog.show(300, 300);
        });
      })
      .then(function(selectedLandmarks) {
        if (selectedLandmarks === null) {
          // Canceled by user
          return null;
        }
        return CATMAID.Landmarks.updateGroupMembers(project.id,
            landmarkGroup.id, selectedLandmarks);
      });
  };

  LandmarkWidget.MODES = {
    landmarks: {
      title: 'Landmarks',
      createControls: function(target) {
        var self = this;
        let newLandmarkGroupSection = document.createElement('span');
        newLandmarkGroupSection.classList.add('section-header');
        newLandmarkGroupSection.appendChild(document.createTextNode('New landmark group'));

        let newLandmarkSection = document.createElement('span');
        newLandmarkSection.classList.add('section-header');
        newLandmarkSection.appendChild(document.createTextNode('New landmark'));
        var state = {};
        return [
          {
            type: 'button',
            label: 'Refresh',
            onclick: function() {
              target.update();
            }
          },
          {
            type: 'child',
            element: newLandmarkSection
          },
          {
            type: 'text',
            label: 'Name',
            title: 'The name of the new landmark',
            value: '',
            length: 8,
            onchange: function() {
              // Check if this landmark exists already
              state.newLandmarkName = this.value;
            }
          },
          {
            type: 'button',
            label: 'Add',
            onclick: function() {
              CATMAID.Landmarks.add(project.id, state.newLandmarkName)
                .then(function(newLandmark) {
                  CATMAID.msg("Success", "Added landmark " + newLandmark.id);
                  target.update();
                })
                .catch(CATMAID.handleError);
            }
          },
          {
            type: 'child',
            element: newLandmarkGroupSection
          },
          {
            type: 'text',
            label: 'Name',
            title: 'The name of the new landmark group',
            value: '',
            length: 8,
            onchange: function() {
              state.newLandmarkGroupName = this.value;
            }
          },
          {
            type: 'button',
            label: 'Add group',
            onclick: function() {
              CATMAID.Landmarks.addGroup(project.id, state.newLandmarkGroupName)
                .then(function(newGroup) {
                  CATMAID.msg("Success", "Added landmark group " + newGroup.id);
                  target.update();
                })
                .catch(CATMAID.handleError);
            }
          }
        ];
      },
      createContent: function(content, widget) {
        var landmarkGroupHeader = content.appendChild(document.createElement('h1'));
        landmarkGroupHeader.appendChild(document.createTextNode('Landmark groups'));

        // Add table with landmark groups
        var landmarkGroupTableWrapper = document.createElement('div');
        landmarkGroupTableWrapper.classList.add('container');
        var landmarkGroupTable = document.createElement('table');
        landmarkGroupTableWrapper.appendChild(landmarkGroupTable);
        content.appendChild(landmarkGroupTableWrapper);
        var landmarkGroupDataTable = $(landmarkGroupTable).DataTable({
          dom: "lfrtip",
          autoWidth: false,
          paging: true,
          lengthMenu: [CATMAID.pageLengthOptions, CATMAID.pageLengthLabels],
          ajax: function(data, callback, settings) {
            widget.updateLandmarkGroups()
              .then(function(result) {
                callback({
                  draw: data.draw,
                  data: result,
                  recordsTotal: result.length,
                  recordsFiltered: result.length
                });
              })
              .catch(CATMAID.handleError);
          },
          order: [],
          columns: [
            {
              data: "id",
              title: "Id",
              orderable: false,
              render: function(data, type, row, meta) {
                return row.id;
              }
            },
            {
              data: "name",
              title: "Name",
              orderable: true,
              render: function(data, type, row, meta) {
                if ("display") {
                  return '<a href="#" data-action="select-group" data-group-id="' +
                      row.id + '" >' + row.name + '</a>';
                } else {
                  return row.name;
                }
              }
            },
            {
              data: "user",
              title: "User",
              orderable: true,
              render: function(data, type, row, meta) {
                return CATMAID.User.safe_get(row.user).login;
              }
            },
            {
              data: "creation_time",
              title: "Created on (UTC)",
              class: "cm-center",
              searchable: true,
              orderable: true,
              render: function(data, type, row, meta) {
                if (type === 'display') {
                  var date = CATMAID.tools.isoStringToDate(row.creation_time);
                  if (date) {
                    return CATMAID.tools.dateToString(date);
                  } else {
                    return "(parse error)";
                  }
                } else {
                  return data;
                }
              }
            },
            {
              data: "edition_time",
              title: "Last edited on (UTC)",
              class: "cm-center",
              orderable: true,
              render: function(data, type, row, meta) {
                if (type === 'display') {
                  var date = CATMAID.tools.isoStringToDate(row.edition_time);
                  if (date) {
                    return CATMAID.tools.dateToString(date);
                  } else {
                    return "(parse error)";
                  }
                } else {
                  return data;
                }
              }
            },
            {
              data: "members",
              title: "Members",
              orderable: true,
              render: function(data, type, row, meta) {
                if (type === 'display') {
                  if (data.length === 0) {
                    return wrapInGroupEditLink("(none)");
                  } else {
                    var namedLandmarks = data.map(function(landmarkId) {
                      return widget.groupedLandmarkToString(row, landmarkId);
                    });
                    return namedLandmarks.join(' ');
                  }
                } else {
                  return data;
                }
              }
            },
            {
              title: "Action",
              orderable: false,
              class: "cm-center",
              render: function(data, type, row, meta) {
                return '<a href="#" data-action="select">Select</a> <a href="#" data-group-id="' +
                    row.id + '" data-action="delete">Delete</a>';
              }
            }
          ],
        }).on('dblclick', 'tr', function(e) {
          var data = landmarkGroupDataTable.row(this).data();
          if (data) {
            var table = $(this).closest('table');
            var tr = $(this).closest('tr');
            var data =  $(table).DataTable().row(tr).data();

            var groupId = parseInt(this.dataset.groupId, 10);

            // Toggle landmark group selection state
            if (widget.selectedLandmarkGroups.has(data.id)) {
              widget.selectedLandmarkGroups.delete(data.id);
            } else {
              widget.selectedLandmarkGroups.add(data.id);
            }
            widget.update();
          }
        }).on('click', 'a[data-action=select-group]', function() {
          var groupId = parseInt(this.dataset.groupId, 10);
          widget.selectedLandmarkGroups.add(groupId);
          widget.update();
        }).on('click', 'a[data-action=delete]', function() {
          var groupId = parseInt(this.dataset.groupId, 10);
          if (!confirm("Are you sure you want to delete landmark group " + groupId + "?")) {
            return;
          }
          CATMAID.Landmarks.deleteGroup(project.id, groupId)
            .then(function() {
              CATMAID.msg("Success", "Group " + groupId + " successfully deleted");
              landmarkGroupDataTable.ajax.reload();
            })
            .catch(CATMAID.handleError);
        }).on('click', 'a[data-action=edit-group-members]', function() {
          var table = $(this).closest('table');
          var tr = $(this).closest('tr');
          var data =  $(table).DataTable().row(tr).data();

          // To edit group memberships an extra dialog will be shown
          widget.editGroupMembers(data)
            .then(function(updatedGroup) {
              if (updatedGroup !== null) {
                CATMAID.msg("Success", "Group updated");
                widget.update();
              }
            });
        }).on('mousedown', 'a[data-action=select-location]', function(e) {
          var index = parseInt(this.dataset.index, 10);
          var landmarkId = parseInt(this.dataset.id, 10);

          var table = $(this).closest('table');
          var datatable = $(table).DataTable();
          var tr = $(this).closest('tr');
          var data =  datatable.row(tr).data();

          // The index refers to the landmark's location list! To find it there,
          // we need the landmark index.
          if (!widget.landmarkIndex) {
            CATMAID.warn('No landmark index available');
            return;
          }
          var landmark = widget.landmarkIndex.get(landmarkId);
          if (!landmark) {
            CATMAID.warn('Couldn\'t find landmark ' + landmarkId);
            return;
          }

          // If left mouse button was used and a location is available, move to
          // it.
          var loc = Number.isNaN(index) ? null : landmark.locations[index];
          if (e.which === 1 && loc) {
            project.moveTo(loc.z, loc.y, loc.x)
              .then(function() {
                // Biefly flash new location
                var nFlashes = 3;
                var delay = 100;
                project.getStackViewers().forEach(function(s) {
                  s.pulseateReferenceLines(nFlashes, delay);
                });
              })
              .catch(CATMAID.handleError);
          }
        });

        // The context menu used to modify locations
        var contextMenu = null;

        // Add table with landmarks
        var landmarkHeader = content.appendChild(document.createElement('h1'));
        landmarkHeader.appendChild(document.createTextNode('Landmarks'));

        // Add table with landmark groups
        var landmarkTable = document.createElement('table');
        var landmarkTableWrapper = document.createElement('div');
        landmarkTableWrapper.classList.add('container');
        landmarkTableWrapper.appendChild(landmarkTable);
        content.appendChild(landmarkTableWrapper);
        var landmarkDataTable = $(landmarkTable).DataTable({
          dom: "lfrtip",
          autoWidth: false,
          paging: true,
          lengthMenu: [CATMAID.pageLengthOptions, CATMAID.pageLengthLabels],
          ajax: function(data, callback, settings) {
            widget.updateLandmarks()
              .then(function(result) {
                // Update landmark group table, so that newly retrieved landmark
                // names can be used.
                landmarkGroupDataTable.rows().invalidate();
                // Call table update
                callback({
                  draw: data.draw,
                  data: result,
                  recordsTotal: result.length,
                  recordsFiltered: result.length
                });
              })
              .catch(CATMAID.handleError);
          },
          order: [],
          columns: [
            {
              data: "id",
              title: "Id",
              orderable: false,
              render: function(data, type, row, meta) {
                return row.id;
              }
            },
            {
              data: "name",
              title: "Name",
              orderable: true,
              render: function(data, type, row, meta) {
                if ("display") {
                  return '<a href="#" data-action="select-landmark" data-id="' +
                      row.id + '" >' + row.name + '</a>';
                } else {
                  return row.name;
                }
              }
            },
            {
              data: "locations",
              title: "Locations",
              orderable: true,
              class: "no-context-menu",
              render: function(data, type, row, meta) {
                if (type === 'display') {
                  if (data.length === 0) {
                    return '<a class="no-context-menu" href="#" data-action="select-location" data-index="' + 'none' + '">(none)</a>';
                  } else {
                    let links = new Array(data.length);
                    for (let i=0; i<links.length; ++i) {
                      links[i] = '<a href="#" class="bordered-list-elem no-context-menu" data-action="select-location" data-index="' +
                          i + '">' + (i + 1) + '</a>';
                    }
                    return links.join('');
                  }
                } else {
                  return data;
                }
              }
            },
            {
              data: "user",
              title: "User",
              orderable: true,
              render: function(data, type, row, meta) {
                return CATMAID.User.safe_get(row.user).login;
              }
            },
            {
              data: "creation_time",
              title: "Created on (UTC)",
              class: "cm-center",
              searchable: true,
              orderable: true,
              render: function(data, type, row, meta) {
                if (type === 'display') {
                  var date = CATMAID.tools.isoStringToDate(row.creation_time);
                  if (date) {
                    return CATMAID.tools.dateToString(date);
                  } else {
                    return "(parse error)";
                  }
                } else {
                  return data;
                }
              }
            },
            {
              data: "edition_time",
              title: "Last edited on (UTC)",
              class: "cm-center",
              orderable: true,
              render: function(data, type, row, meta) {
                if (type === 'display') {
                  var date = CATMAID.tools.isoStringToDate(row.edition_time);
                  if (date) {
                    return CATMAID.tools.dateToString(date);
                  } else {
                    return "(parse error)";
                  }
                } else {
                  return data;
                }
              }
            },
            {
              title: "Action",
              class: "cm-center",
              orderable: false,
              render: function(data, type, row, meta) {
                return '<a href="#" data-action="select">Select</a> <a href="#" data-id="' +
                    row.id + '" data-action="delete">Delete</a>';
              }
            }
          ],
        }).on('dblclick', 'tr', function(e) {
          var data = landmarkDataTable.row(this).data();
          if (data) {
            var table = $(this).closest('table');
            var tr = $(this).closest('tr');
            var data =  $(table).DataTable().row(tr).data();

            var id = parseInt(this.dataset.id, 10);

            // Toggle landmark group selection state
            widget.selectLandmark(data.id);
          }
        }).on('click', 'a[data-action=select-group]', function() {
          var id = parseInt(this.dataset.id, 10);
          widget.selectLandmark(id);
        }).on('click', 'a[data-action=delete]', function() {
          var id = parseInt(this.dataset.id, 10);
          if (!confirm("Are you sure you want to delete landmark " + id + "?")) {
            return;
          }
          CATMAID.Landmarks.delete(project.id, id)
            .then(function() {
              CATMAID.msg("Success", "Landmark " + id + " successfully deleted");
              landmarkDataTable.ajax.reload();
            })
            .catch(CATMAID.handleError);
        }).on('contextmenu', '.no-context-menu', function(e) {
          e.stopPropagation();
          e.preventDefault();
          return false;
        }).on('mousedown', 'a[data-action=select-location]', function(e) {
          var index = parseInt(this.dataset.index, 10);
          var table = $(this).closest('table');
          var datatable = $(table).DataTable();
          var tr = $(this).closest('tr');
          var data =  datatable.row(tr).data();
          var location = Number.isNaN(index) ? null : data.locations[index];

          if (e.which === 1 && location) {
            project.moveTo(location.z, location.y, location.x)
              .then(function() {
                // Biefly flash new location
                var nFlashes = 3;
                var delay = 100;
                project.getStackViewers().forEach(function(s) {
                  s.pulseateReferenceLines(nFlashes, delay);
                });
              })
              .catch(CATMAID.handleError);
            return;
          }

          // Hide current context menut (if any) and show new context menu
          if (contextMenu) {
            contextMenu.hide();
          }

          var items = [
            {
              'title': 'Add current location',
              'value': 'add-current-location',
              'data': data
            },
            {
              'title': 'Add active node location',
              'value': 'add-active-node-location',
              'data': data
            }
          ];
          if (location) {
            items.push({
              'title': 'Delete location',
              'value': 'delete',
              'data': {
                landmark: data,
                location: location
              }
            });
            if (widget.landmarkGroupMemberships && widget.landmarkGroupIndex) {
              let linkedGroups = widget.landmarkGroupMemberships.get(data.id);
              if (linkedGroups) {
                let add = [], remove = [];
                for (var i=0, imax=linkedGroups.length; i<imax; ++i) {
                  var groupId = linkedGroups[i];
                  var group = widget.landmarkGroupIndex.get(groupId);
                  if (!group) {
                    throw new CATMAID.ValueError("Unknown landmark group: " + groupId);
                  }
                  var groupLocations = group.locations;
                  // Check if the landmark location is already a member of this group
                  var isMember = false;
                  for (var j=0, jmax=groupLocations.length; j<jmax; ++j) {
                    let groupLocation = groupLocations[j];
                    if (groupLocation.id == location.id) {
                      isMember = true;
                      break;
                    }
                  }
                  // If it is a member, show option to remove from group,
                  // otherwise show option to add to group.
                  if (isMember) {
                    remove.push({
                      'title': 'Remove from: ' + group.name,
                      'value': 'remove-from-group',
                      'data': {
                        landmark: data,
                        group: group,
                        location: location
                      }
                    });
                  } else {
                    add.push({
                      'title': 'Add to: ' + group.name,
                      'value': 'add-to-group',
                      'data': {
                        landmark: data,
                        group: group,
                        location: location
                      }
                    });
                  }
                }
                items = items.concat(add).concat(remove);
              }
            }
          }
          contextMenu = new CATMAID.ContextMenu({
            disableDefaultContextMenu: true,
            select: function(selection) {
              let data = selection.item.data;
              let action = selection.item.value;
              if (action === 'delete') {
                // Confirm
                if (!confirm("Are you sure you want to delete the link between landmark \"" +
                    data.landmark.name + "\" (" + data.landmark.id + ") and location " +
                    data.location.id + "?")) {
                  return;
                }
                CATMAID.Landmarks.deleteLocationLink(project.id,
                    data.landmark.id, data.location.id)
                  .then(function() {
                    CATMAID.msg("Success", "Deleted link to location");
                    datatable.ajax.reload();
                  });
              } else if (action === 'add-current-location' ||
                  action === 'add-active-node-location') {
                var loc;
                if (action === 'add-current-location') {
                  loc = project.coordinates;
                  if (!loc) {
                    CATMAID.warn('Couldn\'t get project location');
                    return;
                  }
                } else {
                  loc = SkeletonAnnotations.getActiveNodePositionW();
                  if (!loc) {
                    CATMAID.warn("No active node");
                    return;
                  }
                }
                CATMAID.Landmarks.linkNewLocationToLandmark(project.id, data.id, loc)
                  .then(function(link) {
                    CATMAID.msg("Success", "Location linked to landmark");
                    datatable.ajax.reload();
                  })
                  .catch(CATMAID.handleError);
              } else if (action === "add-to-group") {
                // Add the referenced location to the selected group
                CATMAID.Landmarks.addLandmarkLocationToGroup(project.id,
                    data.group.id, data.location.id)
                  .then(function(link) {
                    CATMAID.msg("Success", "Location linked to group");
                    landmarkGroupDataTable.ajax.reload();
                    landmarkDataTable.ajax.reload();
                  })
                  .catch(CATMAID.handleError);
              } else if (action === "remove-from-group") {
                // Remove the referenced location from the selected group
                CATMAID.Landmarks.removeLandmarkLocationFromGroup(project.id,
                    data.group.id, data.location.id)
                  .then(function(link) {
                    CATMAID.msg("Success", "Location removed from group");
                    landmarkGroupDataTable.ajax.reload();
                    landmarkDataTable.ajax.reload();
                  })
                  .catch(CATMAID.handleError);
              }
            },
            hide: function(selected) {
              contextMenu = null;
            },
            items: items
          });
          contextMenu.show(true);
          return false;
        });
      }
    }
  };

  // Export widget
  CATMAID.LandmarkWidget = LandmarkWidget;

  // Register widget with CATMAID
  CATMAID.registerWidget({
    name: "Landmarks",
    description: "Show and manage landmark locations",
    key: "landmarks",
    creator: LandmarkWidget
  });

})(CATMAID);
