/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */
/* global
  checkPermission,
  InstanceRegistry,
  NeuronNameService,
  project,
  requestQueue,
  SelectionTable,
  WindowMaker
*/

(function(CATMAID) {

  "use strict";

  var NeuronAnnotations = function()
  {
    this.widgetID = this.registerInstance();
    this.registerSource();

    this.nextFieldID = 1;    // unique ID for annotation fields added by the "+" button
    // Results of main and sub queries. The main query will be index 0,
    // sub-queries will take the next free slot.
    this.queryResults = [];

    this.entity_selection_map = {};
    this.pid = project.id;

    // Limit the result set
    this.display_length = 50;
    this.display_start = 0;
    this.total_n_results = 0;

    // Indicate if annotations should be displayed
    this.displayAnnotations = true;

    // Listen to annotation change events to update self when needed
    CATMAID.Annotations.on(CATMAID.Annotations.EVENT_ANNOTATIONS_CHANGED,
        this.handleAnnotationUpdate, this);
  };

  NeuronAnnotations.prototype = {};
  $.extend(NeuronAnnotations.prototype, new InstanceRegistry());
  $.extend(NeuronAnnotations.prototype, new CATMAID.SkeletonSource());

  /* Implement interfaces */

  NeuronAnnotations.prototype.getName = function()
  {
      return "Neuron Search " + this.widgetID;
  };

  NeuronAnnotations.prototype.destroy = function()
  {
    this.unregisterInstance();
    this.unregisterSource();
    NeuronNameService.getInstance().unregister(this);
    CATMAID.Annotations.off(CATMAID.Annotations.EVENT_ANNOTATIONS_CHANGED,
        this.handleAnnotationUpdate, this);
  };

  NeuronAnnotations.prototype.append = function() {};
  NeuronAnnotations.prototype.clear = function(source_chain) {};
  NeuronAnnotations.prototype.removeSkeletons = function() {};
  NeuronAnnotations.prototype.updateModels = function() {};

  NeuronAnnotations.prototype.getSelectedSkeletons = function() {
    return this.get_selected_neurons().reduce( function(o, e) {
      if (e.type === 'neuron') {
        o = o.concat(e.skeleton_ids);
      }
      return o;
    }, []);
  };

  NeuronAnnotations.prototype.hasSkeleton = function(skeleton_id) {
    return this.queryResults.some(function(qs) {
      return qs.some(function(e) {
        return e.type === 'neuron' && e.skeleton_ids.some(function(id) {
          return id === skeleton_id;
        });
      });
    });
  };

  NeuronAnnotations.prototype.getSkeletonModel = function(skeleton_id) {
    if (this.hasSkeleton(skeleton_id)) {
      return new SelectionTable.prototype.SkeletonModel(skeleton_id, "",
          new THREE.Color().setRGB(1, 1, 0));
    } else {
      return null;
    }
  };

  NeuronAnnotations.prototype.getSelectedSkeletonModels = function() {
    return this.get_selected_neurons().reduce(function(o, e) {
      if (e.type === 'neuron') {
        e.skeleton_ids.forEach(function(s) {
          o[s] = new SelectionTable.prototype.SkeletonModel(
              s, e.name, new THREE.Color().setRGB(1, 1, 0));
        });
      }
      return o;
    }, {});
  };

  NeuronAnnotations.prototype.highlight = function(skeleton_id)
  {
    // Don't try to highlight when no skeleton ID is given
    if (!skeleton_id) return;

    // Find neuron containing this skeleton_id
    var neurons = this.queryResults.reduce((function(o, qs) {
      o = o.concat(qs.filter(function(e) {
        if (e.type == 'neuron') {
          return e.skeleton_ids.some(function(s) {
            return s == skeleton_id;
          });
        } else {
          return false;
        }
      }));

      return o;
    }).bind(this), []);

    if (neurons) {
      // Remove any highlighting
      $('[class^=neuron_annotation_result_row' + this.widgetID + '_]').css(
          'background-color', '');
      // Highlight the neuron, containing the requested skeleton, if available.
      // Altough the code works for multiple neurons, it should be normally the
      // case that there is only one neuron, belonging to the skeleton.
      neurons.forEach($.proxy(function(n) {
        $('.neuron_annotation_result_row' + this.widgetID + '_' + n.id).css(
            'background-color', SelectionTable.prototype.highlighting_color);
      }, this));
    }
  };

  /**
   * Will refresh the display to update neuron names.
   */
  NeuronAnnotations.prototype.updateNeuronNames = function()
  {
    this.refresh();
  };

  /* Non-interface methods */

  /**
   * In the event of annotations being update while this widget is loaded,
   * update internal use of annotations (e.g. in auto completion).
   */
  NeuronAnnotations.prototype.handleAnnotationUpdate = function(changedEntities) {
    CATMAID.annotations.add_autocomplete_to_input(
        $('.neuron_query_by_annotation_name' + this.widgetID));
    // Re-query if one of the affected enteties is displayed by this search
    // widget.
    if (this.queryResults && this.queryResults.length > 0 &&
        changedEntities && changedEntities.length > 0) {
      var hasEntety = this.queryResults[0].some(function(r) {
        return -1 !== changedEntities.indexOf(r.id);
      });
      if (hasEntety) {
        this.query(false);
      }
    }
  };

  /**
   * Refresh data table UI.
   */
  NeuronAnnotations.prototype.makeDataTable = function() {
    var selector = 'table#neuron_annotations_query_results_table' + this.widgetID;
    var datatable = $(selector).DataTable({
      destroy: true,
      dom: "lrptip",
      paging: true,
      displayStart: this.display_start,
      pageLength: this.display_length,
      lengthMenu: [[50, 100, 500, -1], [50, 100, 500, "All"]],
      order: [],
      processing: true,
      columns: [
        { "orderable": false },
        { "orderable": false },
        { "orderable": false, "visible": this.displayAnnotations }
      ]
    }).off('.dt').on('page.dt', this, function(e) {
      e.data.updateSelectionUI();
    })
  };

  /**
   * Create a table row and passes it to add_row_fn which should it add it
   * whereever it wants. The third parameter specifies the number of indentation
   * steps that should be used.
   */
  NeuronAnnotations.prototype.add_result_table_row = function(entity, add_row_fn,
      indent)
  {
    // Build table row
    var tr = document.createElement('tr');
    tr.setAttribute('class', 'neuron_annotation_result_row' +
            this.widgetID + '_' + entity.id);
    tr.setAttribute('type', entity.type);

    // Checkbox & name column, potentially indented
    var td_cb = document.createElement('td');
    td_cb.setAttribute('colspan', '2');
    var div_cb = document.createElement('div');
    // Make sure the line will not become shorter than 300px
    div_cb.style.minWidth = '200px';
    // Add indentation
    div_cb.style.marginLeft = indent * 1.5 + 'em';
    var cb = document.createElement('input');
    cb.setAttribute('type', 'checkbox');
    cb.setAttribute('entity_id', entity.id);
    cb.setAttribute('class', 'result' + this.widgetID + '_' +
            entity.id);
    var a = document.createElement('a');
    a.setAttribute('href', '#');
    // For a neuron, ask the neuron name service about the name
    var name = ('neuron' !== entity.type) ? entity.name :
        NeuronNameService.getInstance().getName(entity.skeleton_ids[0]);
    a.appendChild(document.createTextNode(name));
    var label = document.createElement('label');
    label.appendChild(cb);
    label.appendChild(a);
    div_cb.appendChild(label);
    td_cb.appendChild(div_cb);
    tr.appendChild(td_cb);

    // Type column
    var td_type = document.createElement('td');
    td_type.appendChild(document.createTextNode(
            entity.type));
    tr.appendChild(td_type);

    // Annotations column
    if (this.displayAnnotations) {
      var td_ann = document.createElement('td');
      // Build list of alphabetically sorted annotations and use layout of jQuery
      // tagbox
      var sortedAnnotations = entity.annotations ? entity.annotations.sort(
          function(a, b) {
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          }) : [];
      var ul = sortedAnnotations.reduce(
        function(o, e) {
          var li = document.createElement('li');
          li.setAttribute('title', 'Show annotation in navigator');
          li.setAttribute('class', 'show_annotation');
          li.setAttribute('neuron_id', entity.id);
          li.setAttribute('annotation_id', e.id);
          li.setAttribute('user_id', e.uid);

          var remove_button = document.createElement('div');
          remove_button.setAttribute('title', 'Remove annotation');
          remove_button.setAttribute('class', 'remove_annotation');
          li.appendChild(document.createTextNode(e.name));
          li.appendChild(remove_button);
          o.appendChild(li);
          return o;
        }, document.createElement('ul'));
      ul.setAttribute('class', 'resultTags');
      td_ann.appendChild(ul);
      tr.appendChild(td_ann);

      // Add row to table
      add_row_fn(tr);
    }

    // Wire up handlers
    if (entity.type == 'neuron') {
      var create_handler = function(skid) {
        return function() {
          CATMAID.TracingTool.goToNearestInNeuronOrSkeleton( 'skeleton', skid );
        };
      };
      // Go to nearest
      if (entity.skeleton_ids.length > 0) {
        $(a).click(create_handler(entity.skeleton_ids[0]));
      } else {
        $(a).click(function() { alert("No skeleton found!"); });
      }
    } else if (entity.type == 'annotation') {
      // Add annotation attribute to link
      a.dataset.annotation = entity.name;
      a.dataset.indent = indent;
    }
    // Add click handlers to remove tags from nodes
    var NA = this;
    $(".remove_annotation", $(ul)).click( function(event) {
        // Prevent the event from bubbling up the DOM tree
        event.stopPropagation();
        // Handle click
        var neuron_id = $(this).parent().attr('neuron_id');
        var annotation_id = $(this).parent().attr('annotation_id');
        CATMAID.remove_annotation(neuron_id,
            annotation_id, (function(message) {
                // Display message returned by the server
                CATMAID.info(message);
                // Update internal representation
                var hasAnnotation = function(r) {
                  return r.annotations.some(function(a) {
                    return a.id == annotation_id;
                  });
                };
                var nextAnnotationMatch = function(r) {
                  for (var i=0; i<r.annotations.length; ++i) {
                    if (r.annotations[i].id == annotation_id) return i;
                  }
                  return null;
                };
                this.queryResults[0].filter(hasAnnotation).forEach(function(r) {
                  var i = nextAnnotationMatch(r);
                  if (i !== null) r.annotations.splice(i, 1);
                });
                // Remove current annotation from displayed list
                var result_tr = $('#neuron_annotations_query_results' +
                    this.widgetID).find('.show_annotation[neuron_id=' +
                    neuron_id + '][annotation_id=' + annotation_id + ']');
                result_tr.fadeOut(1000, function() { $(this).remove(); });
            }).bind(NA));
    });
    // Add click handlers to show an annotation in navigator
    $(".show_annotation", $(ul)).click( function() {
        // Expect name to be the text content of the node
        var annotation_name = $(this).text();
        var annotation_id = $(this).attr('annotation_id');
        // Create a new navigator and set it to an annotation filter node
        var NN = new CATMAID.NeuronNavigator();
        // Create a new window, based on the newly created navigator
        WindowMaker.create('neuron-navigator', NN);
        // Select the cloned node in the new navigator
        NN.set_annotation_node(annotation_name, annotation_id);
    });
    // Add handler to the checkbox infront of each entity
    var create_cb_handler = function(widget) {
      return function() {
            var clicked_cb = this;
            var is_checked = this.checked;
            var entity_id = $(this).attr('entity_id');
            // Update the entities selection state
            widget.entity_selection_map[entity_id] = is_checked;
            // Update sync link
            widget.updateLink(widget.getSelectedSkeletonModels());
            // Potentially remove skeletons from link target
            if (!is_checked && widget.linkTarget) {
              var skids = widget.queryResults.reduce(function(o, qs) {
                qs.forEach(function(e) {
                  if (e.id == entity_id) {
                    o = o.concat(e.skeleton_ids);
                  }
                });
                return o;
              }, []);
              // Prevent propagation loop by checking if the target has the skeletons anymore
              if (skids.some(widget.linkTarget.hasSkeleton, widget.linkTarget)) {
                widget.linkTarget.removeSkeletons(skids);
              }
            }
            // Due to expanded annotations, an entity can appear multiple times. Look
            // therefore for copies of the current one to toggle it as well.
            $("#neuron_annotations_query_results_table" + widget.widgetID).find(
                'td input[entity_id=' + entity_id + ']').each(function() {
                    if (this != clicked_cb) {
                      // Set property without firing event
                      $(this).prop('checked', is_checked);
                    }
                });
        };
    };
    $(cb).change(create_cb_handler(this));
  };

  NeuronAnnotations.prototype.query = function(initialize)
  {
    if (initialize) {
      this.display_start = 0;
      this.total_n_results = 0;
      // Reset "select all" check box
      $('#neuron_annotations_toggle_neuron_selections_checkbox' + this.widgetID)
          .prop('checked', false);
      // Reset "sync to" select box
      $('#neuron_annotations_add_to_selection' + this.widgetID + ' select')
          .val("None").trigger("change");
    }

    var form_data = $('#neuron_query_by_annotations' +
        this.widgetID).serializeArray().reduce(function(o, e) {
          if (0 === e.name.indexOf('neuron_query_by_annotation')) {
            o[e.name] = CATMAID.annotations.getID(e.value);
          } else if (0 === e.name.indexOf('neuron_query_include_subannotation')) {
            // Expect the annotation field to be read out before this
            var ann_input_name = e.name.replace(
                new RegExp('neuron_query_include_subannotation'),
                'neuron_query_by_annotation');
            o[e.name] = o[ann_input_name];
          } else {
            o[e.name] = e.value;
          }
          return o;
        }, {});

    // Make sure that the result is constrained in some way and not all neurons
    // are returned.
    var has_constraints = false;
    for (var field in form_data) {
      if (form_data.hasOwnProperty(field)) {
        // For the annotator field, 'no constraint' means value '-2'. The other
        // fields need to be empty for this.
        var empty_val = '';
        if (field === 'neuron_query_by_annotator') {
          empty_val = '-2';
          if (form_data[field] === 'Team') {
            form_data[field] = Object.keys(CATMAID.ReviewSystem.Whitelist.getWhitelist());
          }
        }
        if (form_data[field] && form_data[field] != empty_val) {
          // We found at least one constraint
          has_constraints = true;
        } else {
          // Delete empty fields
          delete form_data[field];
        }
      }
    }
    if (!has_constraints) {
      alert("Please add at least one constraint before querying!");
      return;
    }

    // Augment form data with offset and limit information
    form_data.display_start = this.display_start;
    form_data.display_length = this.display_length;

    // Here, $.proxy is used to bind 'this' to the anonymous function
    requestQueue.register(django_url + this.pid + '/neuron/query-by-annotations',
        'POST', form_data, $.proxy( function(status, text, xml) {
          if (status === 200) {
            var e = $.parseJSON(text);
            if (e.error) {
              new CATMAID.ErrorDialog(e.error, e.detail).show();
            } else {
              // Unregister last result set from neuron name service
              NeuronNameService.getInstance().unregister(this);
              // Empty selection map and store results
              this.entity_selection_map = {};
              this.queryResults = [];
              this.queryResults[0] = e.entities;
              this.total_n_results = e.entities.length;

              // Mark entities as unselected
              this.queryResults[0].forEach((function(entity) {
                this.entity_selection_map[entity.id] = false;
              }).bind(this));

              // Register search results with neuron name service and rebuild
              // result table.
              var skeletonObject = getSkeletonIDsInResult(e);
              NeuronNameService.getInstance().registerAll(this, skeletonObject,
                  this.refresh.bind(this));
            }
          }
        }, this));
  };

  /**
   * Return an object with fields being the skeleton IDs of all neurons in the
   * search result passed as argument.
   */
  function getSkeletonIDsInResult(result) {
    return result.entities.filter(function(e) {
      return 'neuron' === e.type;
    }).reduce(function(o, e) {
      return e.skeleton_ids.reduce(function(o, skid) {
        o[skid] = {};
        return o;
      }, o);
    }, {});
  }

  /**
   * Make sure the UI doesn't show any outdated data.
   */
  NeuronAnnotations.prototype.invalidateUI = function() {
    var selector = 'table#neuron_annotations_query_results_table' + this.widgetID;
    if ($.fn.DataTable.isDataTable(selector)) {
      var datatable = $(selector).DataTable();
      if (datatable) {
        datatable.rows().invalidate();
      }
    }
  };

  /**
   * Rebuild the search result table.
   */
  NeuronAnnotations.prototype.refresh = function() {
    var entities = this.queryResults[0];
    // Clear table
    var $table = $('#neuron_annotations_query_results' + this.widgetID);
    var $tableBody = $table.find('tbody');
    var selector = 'table#neuron_annotations_query_results_table' + this.widgetID;
    if ($.fn.DataTable.isDataTable(selector)) {
      var datatable = $(selector).DataTable();
      if (datatable) {
        datatable.destroy();
      }
    }
    $tableBody.empty();
    // create appender function which adds rows to table
    var appender = function(tr) {
      $tableBody.append(tr);
    };
    // Mark entities as unselected and create result table rows
    entities.forEach((function(entity) {
      this.add_result_table_row(entity, appender, 0);
    }).bind(this));

    // If there are results, display the result table
    if (entities.length > 0) {
      $('#neuron_annotations_query_no_results' + this.widgetID).hide();
      $('#neuron_annotations_query_results' + this.widgetID).show();
      this.update_result_row_classes();
      // Reset annotator constraints
      $( "#neuron_annotations_user_filter" + this.widgetID).combobox(
          'set_value', 'show_all');

      this.makeDataTable();
    } else {
      $('#neuron_annotations_query_results' + this.widgetID).hide();
      $('#neuron_annotations_query_no_results' + this.widgetID).show();
    }

    // Add expand handler
    var self = this;
    $table.off('click.cm');
    $table.on('click.cm', 'a[data-annotation]', function() {
      var indent = Number(this.dataset.indent);
      var annotation = this.dataset.annotation;
      var aID = CATMAID.annotations.getID(annotation);
      var tr = $(this).closest('tr');

      // If expanded, collapse it. Expand it otherwise.
      if ($(this).is('[expanded]')) {
        // Get sub-expansion ID an mark link not expanded
        var sub_id = $(this).attr('expanded');
        this.removeAttribute('expanded');
        // Find all rows that have an attribute called 'expansion' and delete
        // them.
        var removed_entities = [];
        while (true) {
          var next = $(tr).next();
          if (next.is('[expansion_' + aID + ']')) {
            next.remove();
          } else {
            break;
          }
        }
        // Delete sub-expansion query result
        delete self.queryResults[sub_id];

        // Update current result table classes
        self.update_result_row_classes();
      } else {
        // Find a valid sub query ID as reference
        var sub_id = (function(results, count) {
          while (true) {
            if (results[count] === undefined) {
              // Stop, if a valid ID has been found
              return count;
            } else {
              // Increase counter, if the current ID is in use
              ++count;
            }
          }
        })(self.queryResults, 0);
        // Mark link expanded
        this.setAttribute('expanded', sub_id);
        // Make sure the slot in results array is used for this sub-query by
        // assigning 'null' to it (which is not 'undefined').
        self.queryResults[sub_id] = null;

        // Request entities that are annotated with this annotation
        // and replace the clicked on annotation with the result. Pagination
        // will not be applied to expansions.
        var query_data = {
          'neuron_query_by_annotation': aID
        };
        requestQueue.register(django_url + project.id + '/neuron/query-by-annotations',
            'POST', query_data, function(status, text, xml) {
              if (status === 200) {
                var e = $.parseJSON(text);
                if (e.error) {
                  new CATMAID.ErrorDialog(e.error, e.detail).show();
                } else {
                  // Register search results with neuron name service and rebuild
                  // result table.
                  var skeletonObject = getSkeletonIDsInResult(e);
                  NeuronNameService.getInstance().registerAll(this, skeletonObject,
                      function () {
                        // Append new content right after the current node and save a
                        // reference for potential removal.
                        var appender = function(new_tr) {
                          new_tr.setAttribute('expansion_' + aID, 'true');
                          $(tr).after(new_tr);
                        };

                        // Mark entities as unselected and create result table rows
                        e.entities.forEach((function(entity) {
                          self.entity_selection_map[entity.id] = false;
                          self.add_result_table_row(entity, appender, indent + 1);
                        }).bind(self));

                        // The order of the query result array doesn't matter.
                        // It is therefore possible to just append the new results.
                        self.queryResults[sub_id] = e.entities;
                        // Update current result table classes
                        self.update_result_row_classes();
                      });
                }
              }
        });
      }
    });
  };

  NeuronAnnotations.prototype.update_result_row_classes = function()
  {
    var $tableBody = $('#neuron_annotations_query_results' +
        this.widgetID + ' tbody');
    // First, remove all 'odd' classes
    $("tr", $tableBody).removeClass("odd");
    // Re-add class for currently 'odd' rows
    $("tr:nth-child(odd)", $tableBody).addClass("odd");
  };

  NeuronAnnotations.prototype.add_query_field = function()
  {
    // Create a copy of the first row.
    var $newRow = $("#neuron_query_by_annotation" + this.widgetID).clone();
    $newRow.attr({
        id: 'neuron_query_by_annotation' + this.widgetID + '_' +
            this.nextFieldID,
        name: 'neuron_query_by_annotation' + this.widgetID + '_' +
            this.nextFieldID
    });

    $newRow.children()[0].innerHTML = 'and:';

    // Update the text field attributes.
    var $text = $newRow.find("input[type='text']");
    $text.attr({
        id: 'neuron_query_by_annotation' + this.widgetID + '_' +
            this.nextFieldID,
        name: 'neuron_query_by_annotation' + this.widgetID + '_' +
            this.nextFieldID,
        value: ''
    });
    // Add autocompletion to it
    CATMAID.annotations.add_autocomplete_to_input($text);

    // Update the button attributes.
    var $button = $newRow.find("input[type='button']");
    $button.attr('value', '-');
    $button.click(this.remove_query_field.bind(this, this.nextFieldID));
    $("#neuron_query_by_annotator" + this.widgetID).before($newRow);

    // By default, sub-annotations should not be included
    $newRow.find('input[type=checkbox]')
        .prop('checked', false)
        .attr({
          id: 'neuron_query_include_subannotation' + this.widgetID + '_' +
              this.nextFieldID,
          name: 'neuron_query_include_subannotation' + this.widgetID + '_' +
              this.nextFieldID,
    });

    this.nextFieldID += 1;
  };

  NeuronAnnotations.prototype.remove_query_field = function(rowNum)
  {
    var $row = $("#neuron_query_by_annotation" + this.widgetID + "_" + rowNum);
    $row.remove();
  };

  /**
   * Update selection state of all checkboxes, based on on the internal
   * selection model.
   */
  NeuronAnnotations.prototype.updateSelectionUI = function() {
    var self = this;
    $("#neuron_annotations_query_results_table" + this.widgetID).find(
        'tbody tr td input[class*=result' + this.widgetID + '_]').each(
            function(i, element) {
              var selected = self.queryResults[id].entity_selection_map[id2];
              element.checked = selected;
            });
  };

  NeuronAnnotations.prototype.toggle_neuron_selections = function()
  {
    // Get current check state and update checkboxes and selection map
    var newValue = $("#neuron_annotations_toggle_neuron_selections_checkbox" +
        this.widgetID)[0].checked;
    $("#neuron_annotations_query_results_table" + this.widgetID).find(
        'tbody tr td input[class*=result' + this.widgetID + '_]').each(
            function(i, element) {
              element.checked = newValue;
            });
    this.queryResults.forEach(function(qs) {
      qs.forEach(function(e) {
        this.entity_selection_map[e.id] = newValue;
      }, this);
    }, this);

    // Update sync link
    this.updateLink(this.getSelectedSkeletonModels());
    // Potentially remove skeletons from link target
    if (this.linkTarget) {
      var unselected_skids = this.get_unselected_neurons().reduce(function(o, e) {
        if (e.type === 'neuron') {
          o = o.concat(e.skeleton_ids);
        }
        return o;
      }, []);
      // Prevent propagation loop by checking if the target has the skeletons anymore
      if (unselected_skids.some(this.linkTarget.hasSkeleton, this.linkTarget)) {
        this.linkTarget.removeSkeletons(unselected_skids);
      }
    }

    this.invalidateUI();
  };

  /**
   * If passed true, this function returns a list of selected entities.
   * Otherweise, a list of unselected entities is returned.
   */
  NeuronAnnotations.prototype.get_entities = function(checked)
  {
    var visited = {};
    return this.queryResults.reduce((function(o, qs) {
        qs.forEach(function(e) {
            // Avoid duplicates if the same neuron is checked multiple times and
            // add it only if not yet present.
            if (this.entity_selection_map[e.id] == checked && !(e.id in visited)) {
                o.push(e);
                visited[e.id] = true;
            }
          }, this);
        return o;
      }).bind(this), []);
  };

  NeuronAnnotations.prototype.get_selected_neurons = function()
  {
    return this.get_entities(true);
  };

  NeuronAnnotations.prototype.get_unselected_neurons = function()
  {
    return this.get_entities(false);
  };
  /**
   * Refresh display and auto-completion with updated annotation information.
   */
  NeuronAnnotations.prototype.refresh_annotations = function() {
    // Update auto completion for input fields
    $('.neuron_query_by_annotation_name' + this.widgetID).autocomplete(
        "option", {source: CATMAID.annotations.getAllNames()});
  };

  /**
   * If passed 'true', this function will hide all annotation objects within the
   * result table that hasn't been linked by the user passed as second argument.
   * Otherwise, it will show all annotations.
   */
  NeuronAnnotations.prototype.toggle_annotation_display = function(
      show_only_user, user_id)
  {
    var $results= $('#neuron_annotations_query_results' + this.widgetID);
    if (show_only_user) {
      $results.find('li[user_id!=' + user_id + ']').hide();
      $results.find('li[user_id=' + user_id + ']').show();
    } else {
      $results.find('li').show();
    }
  };

  // Make neuron search widget available in CATMAID namespace
  CATMAID.NeuronAnnotations = NeuronAnnotations;

})(CATMAID);
