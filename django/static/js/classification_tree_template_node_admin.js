// based on: http://djangosnippets.org/snippets/1858/
var title_column='name';
var option_column='class_names';
$(document).ready(function() {
    // cancel, if there is no changelist div of django
    if (!$('#changelist').length)
        return false;
    // for each node, create a list with its title, options, id, parent and index
    var allcats = $('#changelist tbody tr th').map(function(i, el) {
        var form_name_title = 'form-' + i + '-' + title_column;
        var form_name_options = 'form-' + i + '-' + option_column;
        var form_name_parent = 'form-' + i + '-parent';
        return [[document.forms[0][form_name_title].value, document.forms[0][form_name_options].value, $(el).find('a')[0].innerHTML, document.forms[0][form_name_parent].value, i]]
        });

    /**
     * Create a data set out of the available tree data
     * suitable for jsTree.
     */
    function build_tree(par) {
        return allcats.filter(function(i) {
            return this[3] == par;
        }).map(function(i, el) {
            var node = {
                attr: {
                    "id": 'n' + el[2],
                    "pk": el[2],
                    "alt": el[4],
                    },
                data: {
                    title: el[0] + ": " + el[1],
                    attr: {
                        href: el[2] + '/'
                    }
                }
            };
            var chld = build_tree(el[2]);
            if (chld.length)
                node.children = chld;
            return node;
        }).get();

    }
    // create div for the tree
    var treeheight = $('#changelist').innerHeight();
    $('#changelist').hide();
    var treediv = document.createElement('div');
    treediv.style.cssText = 'position:relative;width:100%;';
    treediv.className = 'module';
    treediv.id = 'treediv';
    $(treediv).insertAfter('#changelist');

    // create div for save button
    var savediv = document.createElement('div');
    savediv.style.cssText = 'clear:both;width:100%;height:32px;';
    var btn = document.createElement('input');
    btn.className = 'default';
    btn.type = 'submit';
    btn.value = $('#changelist input[type=submit]:last')[0].value;
    btn.onclick = function() {
        document.forms[0].submit();
        return false;
    }
    $(savediv).append(btn);
    $(savediv).append(btn);
    $(savediv).insertAfter('#changelist');
    $('#changelist input[name=_save]')[0].type = 'text';

    var tree = $("#treediv");

    // handlers

    // open the whole tree when loaded
    tree.bind("loaded.jstree", function (event, data) {                                    
      tree.jstree("open_all");
    });

    // rename
    tree.bind("rename.jstree", function (event, data) {
        var form_name = 'form-' + data.rslt.obj.attr('alt') + '-' + title_column;
        document.forms[0][form_name].value = data.rslt.new_name;
    });

    // double click
    tree.bind("dblclick.jstree", function (event, data) {
        var node = $(event.target).closest("li");
        location.href = node.attr('pk') + '/';
    });

    // before move -- save the old parent
    tree.bind("before.jstree", function (e, data) {
       if(data.func == "move_node"  && data.args[1] == false && data.plugin == "core")
       {
            if (confirm('Are you sure you want to move?') === false) {
               e.stopImmediatePropagation();
               return false;
            }
       }
    });

    // move
    tree.bind("move_node.jstree", function (e, data) {
        var node = data.rslt.o;
        var oldparent = data.rslt.op;
        var newparent = data.rslt.cr;
        // update the parent of the node
        var newparent_id = ((newparent != -1) ? newparent.attr('pk') : '');
        document.forms[0]['form-' + node.attr('alt') + '-parent'].value = newparent_id;
        // iterate the children of the old parent and update their position
        var children = data.inst._get_children(oldparent);
        if (children) {
            children.map(function(i, el) {
                document.forms[0]['form-' + $(el).attr('alt') + '-position'].value = i;
            });
        }
        // iterate the children of new parent and update their position
        children = data.inst._get_children(newparent);
        if (children) {
            children.map(function(i, el) {
                document.forms[0]['form-' + $(el).attr('alt') + '-position'].value = i;
            });
        }
    });

    // create data for tree
    var data = build_tree('');
    // create tree
    tree.jstree({
        plugins : [ "themes", "json_data", "ui", "crrm", "dnd", "contextmenu" ],
        json_data: {data: data},
        themes: {
            theme: "classic",
            url: "http://rablibrary.mpi-cbg.de/catmaid-dev/widgets/themes/kde/jsTree/classic/style.css",
            dots: true,
            icons: true
        },
        ui: {
            select_limit: 1,
            select_multiple_modifier: "ctrl",
            selected_parent_close: "deselect"
        },
        contextmenu: {
            items: {
                create: {
                    label: "Create",
                    icon: "create",
                    visible: function(NODE, TREE_OBJ) {
                        if (NODE.length != 1)
                            return 0;
                        return TREE_OBJ.check("creatable", NODE);
                    },
                    action: function(NODE, TREE_OBJ) {
                        location.href = 'add/?parent=' + $(NODE).attr('pk')
                        },
                    separator_after: true
                },
                rename: {
                    label: "Rename",
                    icon: "rename",
                    visible: function(NODE, TREE_OBJ) {
                        if (NODE.length != 1)
                            return false;
                        return TREE_OBJ.check("renameable", NODE);
                    },
                    action: function(obj) {
                        this.rename(obj);
                    }
                },
                remove: {
                    label: "Remove",
                    icon: "remove",
                    visible: function(NODE, TREE_OBJ) {
                        if (NODE.length != 1)
                            return 0;
                        return TREE_OBJ.check("removable", NODE);
                    },
                    action: function(NODE, TREE_OBJ) {
                        location.href = $(NODE).attr('pk') + '/delete';
                        },
                    separator_after: true
                },
                edit: {
                    label: "Modify",
                    icon: "rename",
                    visible: function(NODE, TREE_OBJ) {
                        if (NODE.length != 1)
                            return false;
                        return TREE_OBJ.check("renameable", NODE);
                    },
                    action: function(NODE, TREE_OBJ) {
                        location.href = $(NODE).attr('pk') + '/';
                    }
                }
            }
        }
    });
});
