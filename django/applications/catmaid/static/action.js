/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

/**
 * An action represents a command that may be run from a keyboard
 * shortcut or a button press.  These objects encapsulate:
 *   - The keys that are linked to that action
 *   - The help text associated with the action
 *   - The button IDs that can trigger the action
 *   - The tooltips for those buttons
 *   - The function that should be run to carry out the action
 */


function Action (properties) {

  var helpText = "[No help text set]";
  var buttonID = null;
  var buttonName = null;
  var keyShortcuts = {};

  /**
     Add a new key shortcut for this action.  'name' should be a
     string representation of the key, and keyCodes should be an
     array of keyCodes that correspond to that key on various
     browsers.  For example, you might call:
        action.addKey( "+", [107, 61, 187] );
  */
  this.addKey = function( name, keyCodes ) {
    if (keyShortcuts.hasOwnProperty(name)) {
      alert("BUG: replacing the keyCodes for "+name+" with Action.addKey");
    }
    keyShortcuts[name] = keyCodes;
  }

  this.hasButton = function( ) {
    return buttonID !== null;
  }

  this.getKeys = function( ) {
    return keyShortcuts;
  }

  this.getKeyShortcutsString = function( ) {
    result = [];
    for (var name in keyShortcuts) {
      if (keyShortcuts.hasOwnProperty(name)) {
        result.push(name);
      }
    }
    return result.join(', ');
  }

  this.getButtonID = function( ) {
    return buttonID;
  }

  this.getButtonName = function( ) {
    return buttonName;
  }

  this.getHelpText = function( ) {
    return helpText;
  }

  this.setButtonID = function( newButtonID ) {
    buttonID = newButtonID;
  }

  this.setButtonName = function( newButtonName ) {
    buttonName = newButtonName;
  }

  this.setHelpText = function( newHelpText ) {
    helpText = newHelpText;
  }

  this.setRun = function( newRun ) {
    this.run = newRun;
  }

  // -------------------------------------------------------------------

  for (key in properties) {
    if (properties.hasOwnProperty(key)) {
      if (key === 'helpText') {
	this.setHelpText(properties.helpText);
      }
      if (key === 'buttonID') {
	this.setButtonID(properties.buttonID);
      }
      if (key === 'buttonName') {
	this.setButtonName(properties.buttonName);
      }
      if (key === 'keyShortcuts') {
	for (name in properties.keyShortcuts) {
	  if (properties.keyShortcuts.hasOwnProperty(name)) {
	    this.addKey(name, properties.keyShortcuts[name]);
	  }
	}
      }
      if (key === 'run') {
	this.setRun(properties.run);
      }
    }
  }
}

var getKeyCodeToActionMap = function( actionArray ) {
  var i, j, keyCodeToKeyAction = {}, action;
  var keyShortcuts, keyCodes, keyCode;
  for (i = 0; i < actionArray.length; ++i) {
    action = actionArray[i];
    keyShortcuts = action.getKeys();
    for (name in keyShortcuts) {
      if (keyShortcuts.hasOwnProperty(name)) {
	keyCodes = keyShortcuts[name];
	for( j = 0; j < keyCodes.length; ++j ) {
	  keyCode = keyCodes[j];
	  if (keyCodeToKeyAction[keyCode]) {
	    alert("BUG: overwriting action for keyCode " + keyCode + " (via '" + name + "')");
	  }
	  keyCodeToKeyAction[keyCode] = action;
	}
      }
    }
  }
  return keyCodeToKeyAction;
}

/** Updates the 'alt' and 'title' attributes on the toolbar
    icons that are documented with help text and key presses.
    Also bind the onClick action for the link that contains
    those icons to the corresponding function */

function createButtonsFromActions(actions, boxID, iconPrefix) {
  var box, action, a, img, buttonID, title, shorcuts;
  box = $( '<div class="box" id="'+boxID+'"></div>' );
  for (i = 0; i < actions.length; ++i) {
    action = actions[i];
    if (action.hasButton()) {
      buttonID = action.getButtonID();
      a = document.createElement('a');
      a.setAttribute('class', 'button');
      a.setAttribute('id', buttonID);
      a.onclick = action.run;
      img = document.createElement('img');
      img.setAttribute('id', buttonID + '_img');
      img.setAttribute('src', STATIC_URL_JS + 'widgets/themes/kde/' + iconPrefix + action.getButtonName() + '.png');
      img.setAttribute('alt', action.getHelpText());
      shortcuts = action.getKeyShortcutsString();
      if (shortcuts.length === 0) {
        title = action.getHelpText();
      } else {
        title = shortcuts + ': ' + action.getHelpText();
      }
      img.setAttribute('title', title);
      a.appendChild(img);
      box.append(a);
    }
  }
  return box;
}

// ---------------------------------------------------------------------

/* These actions are kept in separate arrays, since they need to be
 * added to different DIVs in the toolbar. */

var toolActions = [

	new Action({
		helpText: "Switch to the selector tool",
		buttonID: 'edit_button_select',
		buttonName: "select",
		run: function (e) {
			project.setTool( new Selector() );
			return true;
		}
	}),

	new Action({
		helpText: "Switch to the move tool",
		buttonID: 'edit_button_move',
		buttonName: "move",
		run: function (e) {
			project.setTool( new Navigator() );
			return true;
		}
	}),

	new Action({
		helpText: "Show keyboard shortcut help",
		buttonID: 'key_help_button',
		buttonName: "help",
		keyShortcuts: {
			'F1': [ 112 ]
		},
		run: function (e) {
			WindowMaker.show('keyboard-shortcuts');
			return true;
		}
	}),

  new Action({
    helpText: "Disclaimer",
    buttonID: "disclaimer_button",
    buttonName: 'disclaimer',
    run: function (e) {
      WindowMaker.show('disclaimer');
      return true;
    }
  })

];

/**
 * Craete edit actions depending on tool visibility settings.
 */
var createEditToolActions = function() {
  // re-create the whole array
  editToolActions = new Array();

  if (userprofile.show_text_label_tool) {
    editToolActions.push(
      new Action({
        helpText: "Text label tool",
        buttonID: 'edit_button_text',
        buttonName: 'text',
        run: function (e) {
          project.setTool( new TextlabelTool() );
          return true;
        }
      }));
  }

  if (userprofile.show_tagging_tool) {
    editToolActions.push(
      new Action({
        helpText: "Tagging tool",
        buttonID: 'edit_button_tags',
        buttonName: 'tags',
        run: function (e) {
          project.setTool( new TaggingTool() );
          return true;
        }
      }));
  }

  if (userprofile.show_cropping_tool) {
    editToolActions.push(
      new Action({
        helpText: "Crop tool",
        buttonID: 'edit_button_crop',
        buttonName: 'crop',
        run: function (e) {
          project.setTool( new CroppingTool() );
          return true;
        }
      }));
  }

  if (userprofile.show_segmentation_tool) {
    editToolActions.push(
      new Action({
         helpText: "Segmentation Tool",
         buttonID: 'edit_button_segmentation',
         buttonName: 'canvas',
         keyShortcuts: {
         },
         run: function (e) {
            requestQueue.register(django_url + project.id + '/stack/' + project.focusedStack.id + '/slice-info', "POST", {},
             function (status, text, xml) {
                    if (status === 200) {
                        if (text && text !== " ") {
                            var e = $.parseJSON(text);
                            if (e.error) {
                                alert(e.error);
                            } else {
                                /*if( project.focusedStack.s !== 1 ) {
                                  alert('Segmentation Tool only works on zoom-level 1!');
                                  return;
                                }*/
                                project.setTool( new SegmentationTool() );
                            }
                        }
                    }
            });
         }
      }));
  }

  if (userprofile.show_tracing_tool) {
    editToolActions.push(
      new Action({
        helpText: "Tracing tool",
        buttonID: 'edit_button_trace',
        buttonName: 'trace',
        run: function (e) {
          project.setTool( new TracingTool() );
          return true;
        }
      }));
  }

  if (userprofile.show_ontology_tool) {
    editToolActions.push(
      new Action({
        helpText: "Show ontology tools",
        buttonID: "edit_button_ontology",
        buttonName: 'ontology_tools',
        run: function (e) {
          project.setTool( new OntologyTool() );
          return true;
        }
      }));
  }
}

/* Edit tools are dependent on the current user. Therefore,
 * they get initialized when we know whether the user is
 * logged in or not.
 */
var editToolActions = new Array();

var segmentationWindowActions = [

  new Action({
    helpText: "Show segments table",
    buttonID: "segmentation_button_sliceinfo",
    buttonName: 'table_segments',
    run: function (e) {
      WindowMaker.show('sliceinfo-widget');
      return true;
    }
  }),

  /*new Action({
    helpText: "Show assembly graph",
    buttonID: "assembly_graph_button",
    buttonName: 'table_segments',
    run: function (e) {
      WindowMaker.show('assemblygraph-widget');
      return true;
    }
  }),*/

  new Action({
    helpText: "Show 3D WebGL view",
    buttonID: "view_3d_webgl_button",
    buttonName: '3d-view-webgl',
    run: function (e) {
      WindowMaker.show('3d-webgl-view');
    }
  }),

  new Action({
    helpText: "Show object tree",
    buttonID: "data_button_tree",
    buttonName: 'tree',
    run: function (e) {
      WindowMaker.show('object-tree');
      return true;
    }
  }),

  new Action({
    helpText: "Clustering tool",
    buttonID: "clustering_button",
    buttonName: 'clustering',
    run: function (e) {
      WindowMaker.show('clustering-widget');
      return true;
    }
  }),

];

var tracingWindowActions = [

  new Action({
    helpText: "Show treenode table",
    buttonID: "data_button_table_treenode",
    buttonName: 'table',
    run: function (e) {
      WindowMaker.show('node-table');
      return true;
    }
  }),

  new Action({
    helpText: "Show connector table",
    buttonID: "data_button_table_connector",
    buttonName: 'table_connector',
    run: function (e) {
      WindowMaker.show( 'connector-table' );
      return true;
    }
  }),

  new Action({
      helpText: "Review system",
      buttonID: "data_button_review",
      buttonName: 'table_review',
      run: function (e) {
          WindowMaker.show('review-system');
          return true;
      }
  }),

  new Action({
      helpText: "Notifications",
      buttonID: "data_button_notifications",
      buttonName: 'table_notifications',
      run: function (e) {
          WindowMaker.show('notifications');
          return true;
      }
  }),

    new Action({
        helpText: "Connectivity widget",
        buttonID: "data_button_connectivit",
        buttonName: 'table_connectivity',
        run: function (e) {
            WindowMaker.show('connectivity-widget');
            return true;
        }
    }),


/*    new Action({
        helpText: "Adjacency Matrix widget",
        buttonID: "data_button_connectivity",
        buttonName: 'adj_matrix',
        run: function (e) {
            WindowMaker.show('adjacencymatrix-widget');
            return true;
        }
    }),

  new Action({
      helpText: "Export widget",
      buttonID: "data_button_export_widget",
      buttonName: 'export_widget',
      run: function (e) {
          WindowMaker.show('export-widget');
          return true;
      }
  }),

  new Action({
      helpText: "Graph widget",
      buttonID: "data_button_graph_widget",
      buttonName: 'graph_widget',
      run: function (e) {
          WindowMaker.show('graph-widget');
          return true;
      }
  }),*/

  new Action({ 
      helpText: "Skeleton Analytics widget",
      buttonID: "button_skeleton_analytics_widget",
      buttonName: 'skeleton_analytics_widget',
      run: function (e) {
          WindowMaker.show('skeleton-analytics-widget');
          return true;
      }
  }),

  new Action({
      helpText: "Compartment Graph widget",
      buttonID: "data_button_compartment_graph_widget",
      buttonName: 'graph_widget',
      run: function (e) {
          WindowMaker.show('compartment-graph-widget');
          return true;
      }
  }),

  new Action({
      helpText: "Selection Table",
      buttonID: "data_button_neuron_staging_area_widget",
      buttonName: 'neuron_staging',
      run: function (e) {
          if( !NeuronStagingArea.is_widget_open() ) {
            WindowMaker.show('neuron-staging-area');
          }
          return true;
      }
  }),

  new Action({
    helpText: "Show object tree",
    buttonID: "data_button_tree",
    buttonName: 'tree',
    run: function (e) {
      WindowMaker.show('object-tree');
      return true;
    }
  }),

  new Action({
    helpText: "Show search window",
    buttonID: "data_button_search",
    buttonName: 'search',
    keyShortcuts: {
      '/': [ 191, 47 ]
    },
    run: function (e) {
      WindowMaker.show('search');
      return true;
    }
  }),

  new Action({
      helpText: "Show 3D WebGL view",
      buttonID: "view_3d_webgl_button",
      buttonName: '3d-view-webgl',
      run: function (e) {
        WindowMaker.show('3d-webgl-view');
      }
    }),

  new Action({
    helpText: "Show project statistics",
    buttonID: "data_button_stats",
    buttonName: 'stats',
    run: function (e) {
      WindowMaker.show('statistics');
      return true;
    }
  }),

  new Action({
      helpText: "Show log",
      buttonID: "data_button_table_log",
      buttonName: 'table_log',
      run: function (e) {
          WindowMaker.show( 'log-table' );
          return true;
      }
  }),

  new Action({
      helpText: "Export widget",
      buttonID: "data_button_export_widget",
      buttonName: 'export_widget',
      run: function (e) {
          WindowMaker.show('export-widget');
          return true;
      }
  }),

   ];

// if ( !Detector.webgl ) {
//   tracingWindowActions[tracingWindowActions.length] = new Action({
//     helpText: "Show 3D canvas view",
//     buttonID: "view_3d_button",
//     buttonName: '3d-view',
//     run: function (e) {
//       WindowMaker.show('3d-view');
//       return true;
//     }
//   });
// } else {
//   tracingWindowActions[tracingWindowActions.length] = new Action({
//     helpText: "Show 3D WebGL view",
//     buttonID: "view_3d_webgl_button",
//     buttonName: '3d-view-webgl',
//     run: function (e) {
//       WindowMaker.show('3d-webgl-view');
//     }
//   });
// }
