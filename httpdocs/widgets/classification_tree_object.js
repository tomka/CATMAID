/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

var ClassificationObjectTree = new function()
{
  this.self = this;

  this.deselectAll = function() {
    $('#annotation_tree_object').jstree("deselect_all");
    project.setSelectedSkeleton( null );
    project.selectedObjects.selectedneuron = null;
  }

  this.renameCurrentActiveNode = function() {
    $('#annotation_tree_object').jstree("rename");
  };

  this.overrideNewTreeSubmit = function(container, pid) {
    var form = $("#add-new-classification-form");
    var found = form.length !== 0;
    if (found) {
        form.submit(function(){
            $.ajax({
                type: "POST",
                url: form.attr('action'),
                data: form.serialize(),
                success: function(data, textStatus) {
                    container.innerHTML = "<p>" + data + "</p><p>Reloading in a few seconds.</p>";
                    setTimeout("ClassificationObjectTree.init(" + pid + ")", 1500);
                }
            });
            return false;
        });
    }

    return found;
  }

  this.overrideSelectTreeSubmit = function(container, pid) {
    var form = $("#select-classification-form");
    var found = form.length !== 0;
    if (found) {
        form.submit(function(){
            $.ajax({
                type: "POST",
                url: form.attr('action'),
                data: form.serialize(),
                success: function(data, textStatus) {
                    container.innerHTML = "<p>" + data + "</p><p>Reloading in a few seconds.</p>";
                }
            });
            return false;
        });
    }

    return found;
  }

  this.overrideRemoveTreeLink = function(container, pid) {
    var remove_link = $("#remove_classification_link");
    var found = remove_link.length !== 0;
    if (found) {
         remove_link.click(function(){
             if (confirm("Are you sure you want to remove the whole classification tree?")) {
                 $.ajax({
                     type: "POST",
                     url: remove_link.attr('href'),
                     success: function(data, textStatus) {
                         container.innerHTML = "<p>" + data + "</p><p>Reloading in a few seconds.</p>";
                         setTimeout("ClassificationObjectTree.init(" + pid + ")", 1500);
                     }
                 });
             }
             return false;
         });
    }

    return found;
  }

  this.overrideAddTreeLink = function(container, pid) {
    var remove_link = $("#add_classification_link");
    var found = remove_link.length !== 0;
    if (found) {
         remove_link.click(function(){
             $.ajax({
                 type: "POST",
                 url: remove_link.attr('href'),
                 success: function(data, textStatus) {
                     container.innerHTML = data;
                 }
             });
             return false;
         });
    }

    return found;
  }

  /**
   * Initialization of the window.
   */
  this.init = function (pid) {
    // display the classification tree view
    requestQueue.register(django_url + pid + '/class-tree/show',
        'GET', undefined,
        function(status, data, text) {
            if (status !== 200) {
                alert("The server returned an unexpected status (" + status + ") " + "with error message:\n" + text);
            } else {
                var container = document.getElementById("classification_content");
                container.innerHTML = data;
                // Override the submit behaviour if the submit form is displayed
                var newTreeDialog = ClassificationObjectTree.overrideNewTreeSubmit(container, pid);
                // Override the remove link behaviour
                var removeTreeLink = ClassificationObjectTree.overrideRemoveTreeLink(container, pid);
                // Override the add link behaviour
                var addTreeLink = ClassificationObjectTree.overrideAddTreeLink(container, pid);

                if (!newTreeDialog) {
                    // display the tree
                    ClassificationObjectTree.load_tree(pid);
                }
            }
        });
  };

  this.load_tree = function(pid) {
    // id of object tree
    var annotation_tree_id = "#annotation_tree_object";
    var tree = $(annotation_tree_id);

    $("#refresh_annotation_tree").click(function () {
      tree.jstree("refresh", -1);
    });

    tree.bind("reload_nodes.jstree",
       function (event, data) {
         if (ClassificationObjectTree.currentExpandRequest) {
           openTreePath($('#annotation_tree_object'), ClassificationObjectTree.currentExpandRequest);
         }
       });

    tree.jstree({
      "core": {
        "html_titles": false,
        "load_open": true
      },
      "plugins": ["themes", "json_data", "ui", "crrm", "types", "dnd", "contextmenu"],
      "json_data": {
        "ajax": {
          "url": django_url + pid + '/class-tree/list',
          "data": function (n) {
            var expandRequest, parentName, parameters;
            // depending on which type of node it is, display those
            // the result is fed to the AJAX request `data` option
            parameters = {
              "pid": pid,
              "parentid": n.attr ? n.attr("id").replace("node_", "") : 0
            };
            if (ClassificationObjectTree.currentExpandRequest) {
              parameters['expandtarget'] = ClassificationObjectTree.currentExpandRequest.join(',');
            }
            if (n[0]) {
              parameters['parentname'] = n[0].innerText;
            }
            return parameters;
          },
          "success": function (e) {
            if (e.error) {
              alert(e.error);
            }
          }
        },
        "cache": false,
        "progressive_render": true
      },
      "ui": {
        "select_limit": 1,
        "select_multiple_modifier": "ctrl",
        "selected_parent_close": "deselect"
      },

      "themes": {
        "theme": "classic",
        "url": "widgets/themes/kde/jsTree/classic/style.css",
        "dots": false,
        "icons": true
      },
      "contextmenu": {
        "items": function (obj) {
          var id_of_node = obj.attr("id");
          var type_of_node = obj.attr("rel");
          var template_node_id = obj.attr("template_node_id");
          var child_nodes = JSON.parse(obj.attr("child_nodes"));
          var menu = {};
          // Add entries to create child classes.
          for (child_id in child_nodes) {
            var child = child_nodes[child_id];
            var node_name = child.name;
            var class_names = child.class_names;
            var class_instances = child.class_instances;
            var menu_id = 'add_child_' + node_name;
            // Create "add child node" sub menu and put child nodes
            // with the same name into the same sub menu.
            var submenu = {}
            if (menu[menu_id]) {
                submenu = menu[menu_id]['submenu'];
            }
            for(i=0; i< class_names.length; i++){
              var subchild = class_names[i];
              // disable option if type already exists
              var disabled = (class_instances.indexOf(subchild) != -1) ||
                 (child.exclusive && class_instances.length > 0);
              submenu['add_child_' + child_id + '_sub_' + i] = {
                "separator_before": false,
                "separator_after": false,
                "_disabled": disabled,
                "label": subchild,
                // the action function has to be created wth. of a closure
                "action": (function(name, tn_id) { return function (obj) {
                  att = {
                    "state": "open",
                    "data": name,
                    "attr": {
                        "template_node_id": tn_id,
                        "classname": name,
                        "relname": child.rel_name,
                        //"rel": type_of_node,
                    }
                  };
                  this.create(obj, "inside", att, null, true);
                }})(subchild, child_id)
              }
            }
            // add complete contextmenu
            menu[menu_id] = {
              "separator_before": false,
              "separator_after": false,
              "label": 'Add ' + node_name,
              "submenu": submenu,
            };
          }
          // Add custom renames
          if (type_of_node === "root") {
            // Add root renaming entry
            menu["rename_root"] = {
                "separator_before": true,
                "separator_after": false,
                "label": "Rename root",
                "action": function (obj) {
                  this.rename(obj);
                }
              };
          } else if (type_of_node === "element") {
            var template_node_name = obj.attr("template_node_name");
            var template_node_alt = JSON.parse(obj.attr("template_node_alt"));
            // Build changing submenu
            submenu = {}
            for(i=0; i < template_node_alt.length; i++){
                var alternative = template_node_alt[i];
                var parent = obj.parents("li:eq(0)");
                submenu['change_to_alt_' + i] = {
                    "separator_before": false,
                    "separator_after": false,
                    "label": alternative,
                    // the action function has to be created wth. of a closure
                    "action": (function(name) { return function (obj) {
                      data = {
                        "operation": "retype_node",
                        "newtype": name,
                        "id": obj.attr("id").replace("node_", ""),
                        "parentid": parent.attr("id").replace("node_", ""),
                      };

                      $.ajax({
                        async: false,
                        cache: false,
                        type: 'POST',
                        url: django_url + project.id + '/class-tree/instance-operation',
                        data: data,
                        dataType: 'json',
                        success: function () {
                          // reload the node
                          // TODO: Refresh only the sub tree, startins from parent
                          tree.jstree("refresh", -1);
                        }
                      });
                    }})(alternative)
                };
            }

            // Add changing entry
            menu["change_element"] = {
                "separator_before": true,
                "separator_after": false,
                "_disabled": (submenu.length == 0),
                "label": "Change " + template_node_name,
                "submenu": submenu
            };
            // Add removing entry
            menu["remove_element"] = {
                "separator_before": true,
                "separator_after": false,
                "label": "Remove",
                "action": function (obj) {
                  this.remove(obj);
                }
            };
          }
          return menu;
        }

      },
      "crrm": {
        "move": {
          "always_copy": false,
          "check_move": function (m) {

            // valid moves (class - class)
            valid_moves = {
              "group": ["root", "group"],
              // part_of
              "neuron": ["group"],
              // part_of
              "skeleton": ["neuron"] // model_of
            };

            // http://snook.ca/archives/javascript/testing_for_a_v

            function oc(a) {
              var o = {}, i;
              for (i = 0; i < a.length; i++) {
                o[a[i]] = '';
              }
              return o;
            }

            srcrel = m.o.attr("rel"); // the node being moved
            dstrel = m.r.attr("rel"); // the node moved to
            if ( oc(valid_moves[srcrel]).hasOwnProperty(dstrel) ) {
              return true;
            }
            else {
              return false;
            }
          }
        }
      },
      "types": {
        "max_depth": -2,
        "max_children": -2,
        "valid_children": "all",
        "types": {
          // the default type
          "default": {
            "valid_children": "all",
            //"select_node"	: false,
            //"open_node"	: true,
            //"close_node"	: true,
            //"create_node"	: true,
            //"delete_node"	: true
          },
          "root": {
            "icon": {
              "image": "widgets/themes/kde/jsTree/neuron/root.png"
            },
            "valid_children": "all",
            "start_drag": false,
            //"select_node": false,
            "delete_node": false,
            "remove": false
          },
          "element": {
            "icon": {
              "image": "widgets/themes/kde/jsTree/neuron/group.png"
            },
            "valid_children": "all",
            //"start_drag": false,
            //"select_node": false,
            //"delete_node": false,
            //"remove": false
          },
        }
      }
    });

    // handlers
    //	"inst" : /* the actual tree instance */,
    //	"args" : /* arguments passed to the function */,
    //	"rslt" : /* any data the function passed to the event */,
    //	"rlbk" : /* an optional rollback object - it is not always present */
    tree.bind("loaded.jstree", function (event, data) {
      tree.jstree("open_all");
    });

    // select a node
    tree.bind("select_node.jstree", function (event, data) {
      console.log("Select node");
      id = parseInt( data.rslt.obj.attr("id").replace("node_", "") );
      type = data.rslt.obj.attr("rel");
      if (type === "neuron") {
        project.selectedObjects.selectedneuron = id;
        project.setSelectedSkeleton( null );
      } else if (type === "skeleton") {
        project.selectedObjects.selectedneuron = null;
        project.setSelectedSkeleton( id );
      } else {
        project.selectedObjects.selectedneuron = null;
        project.setSelectedSkeleton( null );
      }
    });

    // create a node
    tree.bind("create.jstree", function (e, data) {
      var mynode = data.rslt.obj;
      var myparent = data.rslt.parent;
      data = {
        "operation": "create_node",
        "parentid": data.rslt.parent.attr("id").replace("node_", ""),
        "template_node_id": data.rslt.obj.attr("template_node_id"),
        "classname": data.rslt.obj.attr("classname"),
        "relationname": data.rslt.obj.attr("relname"),
        "objname": data.rslt.name,
        "pid": pid
      };

      $.ajax({
        async: false,
        cache: false,
        type: 'POST',
        url: django_url + project.id + '/class-tree/instance-operation',
        data: data,
        dataType: 'json',
        success: function (data2) {
          // update node id
          mynode.attr("id", "node_" + data2.class_instance_id);
          // reload the node
          //tree.jstree("refresh", myparent);
          //tree.jstree("load_node", myparent, function() {}, function() {});
          // TODO: Refresh only the sub tree, startins from parent
          tree.jstree("refresh", -1);
        }
      });
    });

    // rename a node
    tree.bind("rename.jstree", function (e, data) {
      $.post(django_url + project.id + '/class-tree/instance-operation', {
        "operation": "rename_node",
        "id": data.rslt.obj.attr("id").replace("node_", ""),
        "title": data.rslt.new_name,
        "classname": data.rslt.obj.attr("rel"),
        "pid": pid
      }, function (r) {
          r = $.parseJSON(r);
          if(r['error']) {
              alert(r['error']);
              $.jstree.rollback(data.rlbk);
          }
      });
    });

    // remove a node
    $(annotation_tree_id).bind("remove.jstree", function (e, data) {
      var treebefore = data.rlbk;
      var friendly_name = data.rslt.obj.context.text; // data.rslt.obj.text().replace(/(^\s+|\s+$)/g, '');
      if (!confirm("Are you sure you want to remove '" + friendly_name + "' and anything it contains?")) {
        $.jstree.rollback(treebefore);
        return false;
      }

      type = data.rslt.obj.attr("rel");

      $.post(django_url + project.id + '/class-tree/instance-operation', {
            "operation": "has_relations",
            "relationnr": 1,
            "relation0": "part_of",
            "id": data.rslt.obj.attr("id").replace("node_", ""),
            "pid": pid
        }, function (r) {
          r = $.parseJSON(r);
          if (r.error) {
            alert(r.error);
            $.jstree.rollback(treebefore);
            return;
          }
          $.blockUI({ message: '<h2><img src="widgets/busy.gif" /> Removing classification tree node. Just a moment...</h2>' });
          // Remove group, neuron, skeleton
          console.log(data.rslt.obj.attr("rel"));
          $.post(django_url + project.id + '/class-tree/instance-operation', {
                "operation": "remove_node",
                "id": data.rslt.obj.attr("id").replace("node_", ""),
                "title": data.rslt.new_name,
                "pid": pid,
                "rel": data.rslt.obj.attr("rel")
              }, function (r) {
                $.unblockUI();
                r = $.parseJSON(r);
                if (r['error']) {
                  alert(r['error']);
                  $.jstree.rollback(treebefore);
                  return;
                }
                if(r['status']) {
                    $("#annotation_tree_object").jstree("refresh", -1);
                    project.updateTool();
                    $('#growl-alert').growlAlert({
                      autoShow: true,
                      content: 'Classification tree element' + data.rslt.obj.context.text + ' removed.',
                      title: 'SUCCESS',
                      position: 'top-right',
                      delayTime: 2500,
                      onComplete: function() { g.remove(); }
                    });
                };
          });
        });

    });

    // move a node
    $(annotation_tree_id).bind("move_node.jstree", function (e, data) {
      var src = data.rslt.o;
      var ref = data.rslt.r;

      // the relationship stays the same (otherwise it would not be
      // a valid move), thus we only have to change the parent
      $.ajax({
        async: false,
        cache: false,
        type: 'POST',
        url: django_url + project.id + '/object-tree/instance-operation',
        data: {
          "operation": "move_node",
          "src": src.attr("id").replace("node_", ""),
          "ref": ref.attr("id").replace("node_", ""),
          "classname": src.attr("rel"),
          "targetname": ref.context.text,
          "pid": pid
        },
        success: function (r, status) {
          r = $.parseJSON(r);
          if(r.error) {
            $.jstree.rollback(data.rlbk);
            alert("ERROR: " + r['error']);
          }
          else {
            $("#annotation_tree_object").jstree("refresh", -1);
          }
        }
      });
    });

  };

  /* A function that takes an array of ids starting from the root id
   * and ending in any given node,
   * and walks the array opening each child node as requested.
   */
  var openTreePath = function(treeOb, path) {
    var subNodeSelector;
    if (path.length < 1) {
      ClassificationObjectTree.currentExpandRequest = null;
      ClassificationObjectTree.afterRefresh = false;
      return;
    }
    subNodeSelector = "#node_" + path[0];
    /* If the node doesn't exist, refresh the whole tree in case it is
       one of the special nodes in "Isolated synaptic terminals" that
       is only fetch on selection of that node.  However, careful not
       to loop in the case that this node can't be found even after
       the refresh: */
    if ($(subNodeSelector).length === 0) {
      if (!ClassificationObjectTree.afterRefresh) {
        ClassificationObjectTree.afterRefresh = true;
        treeOb.jstree("refresh", -1);
        // The handler for reload_nodes.jstree will then recall
        // openTreePath, so just return in either case.
      }
      return;
    }
    // Invoke the open_node method on the jstree instance of the treeOb DOM element:
    treeOb.jstree("open_node",
                  $(subNodeSelector),
                  function() {
                    openTreePath(treeOb, path.slice(1))
                  },
                  false );
    if (1 == path.length) {
      // Set the skeleton node (the last id) as selected:
      treeOb.jstree("deselect_all");
      treeOb.jstree("select_node", $(subNodeSelector));
    }
  };

  this.requestOpenTreePath = function(treenode) {
    // Check if the node is already highlighted
    if ($('#node_' + treenode.skeleton_id + ' a').hasClass('jstree-clicked')) {
      return;
    }

    // Else, highlight it:
    $.ajax({
      async: true,
      cache: false,
      type: 'POST',
      //url: "model/tree.object.expand.php",
      url: django_url + project.id + '/object-tree/expand',
      data: { "skeleton_id" : treenode.skeleton_id,
              "pid" : project.id },
      success: function (r, status) {
                 r = $.parseJSON(r);
                 if (r['error']) {
                   alert("ERROR: " + r['error']);
                 } else {
                   ClassificationObjectTree.currentExpandRequest = r;
                   var treeOb = $('#annotation_tree_object');
                   openTreePath(treeOb, r);
                 }
               }
    });
  };

  // Refresh the Object Tree if it is visible.
  this.refresh = function() {
    if ($('#annotation_tree_widget').css('display') === "block") {
      $("#annotation_tree_object").jstree("refresh", -1);
    }
  };

};
