/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

/**
 * Global access to window and project control events and variables.
 * @namespace
 */
CATMAID.Init = {};
CATMAID.asEventSource(CATMAID.Init);
CATMAID.Init.EVENT_PROJECT_CHANGED = "init_project_changed";
CATMAID.Init.EVENT_USER_CHANGED = "init_user_changed";

var global_bottom = 29;

var requestQueue;
var project;

var cachedProjectsInfo = null;

var current_dataview;
var dataview_menu;

var project_menu;

var stack_menu;

var message_menu;
/**
 * A menu for user related links.
 * @type {Menu}
 */
var user_menu;

var session;
var msg_timeout;
/**
 * Length (in milliseconds) of the message lookup interval.
 * @type {Number}
 */
var MSG_TIMEOUT_INTERVAL = 60000;
/**
 * Interval (in milliseconds) to check client CATMAID version against server
 * version.
 * @type {Number}
 */
CATMAID.Init.CHECK_VERSION_TIMEOUT_INTERVAL = 15*60*1000;

var rootWindow;

/**
 * An object to store profile properties of the current user.
 * @type {CATMAID.Userprofile}
 */
var userprofile = null;

function checkPermission(p) {
  return CATMAID.hasPermission(project.getId(), p);
}

function mayEdit() {
  return checkPermission('can_annotate');
}

function mayView() {
  return checkPermission('can_annotate') || checkPermission('can_browse');
}

/**
 * Queue a login request on pressing return.
 * Used as onkeydown-handler in the account and password input fields.
 *
 * @param  {Object}  e Key event.
 * @return {boolean}   False if enter was pressed, true otherwise.
 */
function login_oninputreturn(e) {
  if (CATMAID.ui.getKey(e) == 13) {
    login(document.getElementById("account").value, document.getElementById("password").value);
    return false;
  } else
  return true;
}

/**
 * Queue a login request optionally using account and password,
 * freeze the window to wait for an answer.
 *
 * If account or password are set, a new session is instantiated or an error occurs.
 * If account and password are not set, an existing session is tried to be recognised.
 *
 * @param  {string}   account
 * @param  {string}   password
 * @param  {function} completionCallback
 */
function login(
    account,
    password,
    completionCallback
)
{
  var loginCompletion = function ( status, text, xml ) {
    handle_login( status, text, xml, completionCallback );
  };
  if ( msg_timeout ) window.clearTimeout( msg_timeout );

  CATMAID.ui.catchEvents( "wait" );
  if ( account || password ) {
    // Attempt to login.
    requestQueue.register(
      django_url + 'accounts/login',
      'POST',
      { name : account, pwd : password },
      loginCompletion );
  }
  else {
    // Check if the user is logged in.
    requestQueue.register(
      django_url + 'accounts/login',
      'GET',
      undefined,
      loginCompletion );
  }
}

/**
 * Handle a login request answer.
 * If the answer was session data, establish a session, update the projects menu.
 * If the answer was an error, display an error alert.
 * If the answer was a notice, do nothing.
 *
 * @param  {number}    status             XHR response status.
 * @param  {string}    text               XHR response content.
 * @param  {Object}    xml                XHR response XML (unused).
 * @param  {function=} completionCallback Completion callback (no arguments).
 */
function handle_login(status, text, xml, completionCallback) {
  if (status == 200 && text) {
    var e = JSON.parse(text);

    if (e.id) {
      session = e;
      document.getElementById("account").value = "";
      document.getElementById("password").value = "";
      document.getElementById("session_longname").replaceChild(
      document.createTextNode(e.longname), document.getElementById("session_longname").firstChild);
      document.getElementById("login_box").style.display = "none";
      document.getElementById("logout_box").style.display = "block";
      document.getElementById("session_box").style.display = "block";

      document.getElementById("message_box").style.display = "block";

      // Check for unread messages
      check_messages();

      // Update user menu
      user_menu.update({
        "user_menu_entry_1": {
          action: django_url + "user/password_change/",
          title: "Change password",
          note: "",
        },
        "user_menu_entry_2": {
          action: getAuthenticationToken,
          title: "Get API token",
          note: ""
        }
      });

    } else if (e.error) {
      alert(e.error);
    }

    // Continuation for user list retrieval
    done = function () {
      handle_profile_update(e);
      updateProjects(completionCallback);
    };

    if (e.id || (e.permissions && -1 !== e.permissions.indexOf('catmaid.can_browse'))) {
      // Asynchronously, try to get a full list of users if a user is logged in
      // or the anonymous user has can_browse permissions.
      CATMAID.User.getUsers(done);
    } else {
      done();
    }
  } else if (status != 200) {
    // Of course, lots of non-200 errors are fine - just report
    // all for the moment, however:
    alert("The server returned an unexpected status (" + status + ") " + "with error message:\n" + text);
    if ( typeof completionCallback !== "undefined" ) {
      completionCallback();
    }
  }
}

function getAuthenticationToken() {
  var dialog = new CATMAID.OptionsDialog('API Authentication Token');
  dialog.appendMessage('To retrieve your API authentication token, you must ' +
                       're-enter your password.');
  var password = dialog.appendField('Password:', 'password', '', true);
  password.setAttribute('type', 'password');

  dialog.onOK = function () {
    CATMAID.fetch('/api-token-auth/',
                  'POST',
                  {username: username, password: password.value})
        .then(function (json) {
          var resultDialog = new CATMAID.OptionsDialog('API Authentication Token');
          resultDialog.appendHTML('Your API token is');
          var container = document.createElement('p');
          var token = document.createElement('input');
          token.setAttribute('value', json.token);
          token.setAttribute('readonly', true);
          token.setAttribute('size', 40);
          var copyButton = $('<button />')
              .button({
                icons: {primary: "ui-icon-clipboard"},
                label: 'Copy to clipboard',
                text: false
              })
              .click(function () {
                token.select();
                document.execCommand('copy');
              });
          container.appendChild(token);
          container.appendChild(copyButton.get(0));
          resultDialog.dialog.appendChild(container);
          resultDialog.appendHTML(
              'This token is tied to your account and shares your ' +
              'permissions. ' +
              'Requests using this token can do anything your account can ' +
              'do, so <b>do not distribute this token or check it into ' +
              'source control.</b>');
          resultDialog.appendHTML(
              'For help using your API token, see the ' +
              '<a target="_blank" href="' +
              CATMAID.makeDocURL('api.html#api-token') + '">' +
              'API use documentation</a> and ' +
              '<a target="_blank" href="' + CATMAID.makeURL('/apis/') + '">' +
              'this server\'s API documentation</a>.');
          resultDialog.show(460, 280, true);
        });
  };

  dialog.show(460, 200, true);
}

/**
 * Queue a logout request.
 * Freeze the window to wait for an answer.
 */
function logout() {
  if (msg_timeout) window.clearTimeout(msg_timeout);

  CATMAID.ui.catchEvents("wait");
  requestQueue.register(django_url + 'accounts/logout', 'POST', undefined, handle_logout);
}

/**
 * Handle a logout request response.
 * Update the project menu.
 *
 * @param  {number}    status             XHR response status.
 * @param  {string}    text               XHR response content.
 * @param  {Object}    xml                XHR response XML (unused).
 */
function handle_logout(status, text, xml) {
  session = undefined;
  document.getElementById( "login_box" ).style.display = "block";
  document.getElementById( "logout_box" ).style.display = "none";
  document.getElementById( "session_box" ).style.display = "none";

  document.getElementById( "message_box" ).style.display = "none";

  if ( project && project.id ) project.setTool( new CATMAID.Navigator() );

  if (status == 200 && text) {
    var e = $.parseJSON(text);
    handle_profile_update(e);
  }

  updateProjects();
}

/**
 * Update profile dependent information, e.g., the visibility of tools in the
 * toolbar.
 *
 * @param  {Object} e The parsed JSON response object.
 */
function handle_profile_update(e) {
  try {
    if (e.userprofile) {
      userprofile = new CATMAID.Userprofile(e.userprofile);
      username = e.username;
    } else {
      throw "The server returned no valid user profile.";
    }
  } catch (error) {
    /* A valid user profile is needed to start CATMAID. This is a severe error
     * and a message box will tell the user to report this problem.
     */
    new CATMAID.ErrorDialog("The user profile couldn't be loaded. This " +
        "however, is required to start CATMAID. Please report this problem " +
        "to your administrator and try again later.", error).show();
    return;
  }

  // update the edit tool actions and its div container
  var new_edit_actions = CATMAID.createButtonsFromActions(CATMAID.EditTool.actions,
    'toolbox_edit', '');
  $('#toolbox_edit').replaceWith(new_edit_actions);
  $('#toolbox_edit').hide();

  // Re-configure CSRF protection to update the CSRF cookie.
  CATMAID.setupCsrfProtection();

  // Update all datastores to reflect the current user before triggering
  // any events. This is necessary so that settings are correct when
  // updating for user change.
  CATMAID.DataStoreManager.reloadAll().then(function () {
    CATMAID.Init.trigger(CATMAID.Init.EVENT_USER_CHANGED);
  });
}

/**
 * Queue a project-menu-update request.
 *
 * @param  {function=} completionCallback Completion callback (no arguments).
 */
function updateProjects(completionCallback) {
  CATMAID.updatePermissions();

  project_menu.update(null);

  document.getElementById("projects_h").style.display = "none";
  document.getElementById("project_filter_form").style.display = "none";

  var pp = document.getElementById("projects_dl");

  while (pp.firstChild) pp.removeChild(pp.firstChild);

  var w = document.createElement("dd");
  w.className = "wait_bgwhite";
  w.appendChild(document.createTextNode("loading ..."));
  pp.appendChild(w);

  // Destroy active project
  // TODO: Does this really have to happen here?
  if (project) {
    project.destroy();
    project = undefined;
  }

  CATMAID.fetch('projects/', 'GET')
    .catch(function(error) {
      // Show error and continue with null JSON
      CATMAID.error("Could not load available projects: " + error.error, error.detail);
      return null;
    })
    .then(function(json) {
      // recreate the project data view
      if (current_dataview) {
        switch_dataview(current_dataview);
      } else {
        load_default_dataview();
      }
      cachedProjectsInfo = json;

      // Prepare JSON so that a menu can be created from it. Display only
      // projects that have at least one stack linked to them.
      var projects = json.filter(function(p) {
        return p.stacks.length > 0;
      }).map(function(p) {
        var stacks = p.stacks.reduce(function(o, s) {
          o[s.id] = {
            'title': s.title,
            'comment': s.comment,
            'note': '',
            'action': openProjectStack.bind(window, p.id, s.id, false)
          };
          return o;
        }, {});
        var stackgroups = p.stackgroups.reduce(function(o, sg) {
          o[sg.id] = {
            'title': sg.title,
            'comment': sg.comment,
            'note': '',
            'action': openStackGroup.bind(window, p.id, sg.id, false)
          };
          return o;
        }, {});

        return {
          'title': p.title,
          'note': '',
          'action': [{
            'title': 'Stacks',
            'comment': '',
            'note': '',
            'action': stacks
          }, {
            'title': 'Stack groups',
            'comment': '',
            'note': '',
            'action': stackgroups
          }]

        };
      });

      project_menu.update(projects);
      CATMAID.ui.releaseEvents();
      if (CATMAID.tools.isFn(completionCallback)) {
        completionCallback();
      }
    });
}

function updateProjectListMessage(text) {
  $('#project_list_message').text(text);
}

/**
 * Do a delayed call to updateProjectListFromCache() and indicate
 * the progress.
 */
var cacheLoadingTimeout = null;
function updateProjectListFromCacheDelayed()
{
  // the filter form can already be displayed
  $('#project_filter_form').show();
  // indicate active filtered loading of the projects
  var indicator = document.getElementById("project_filter_indicator");
  window.setTimeout( function() { indicator.className = "filtering"; }, 1);

  // clear timeout if already present and create a new one
  if (cacheLoadingTimeout !== null)
  {
    clearTimeout(cacheLoadingTimeout);
  }
  cacheLoadingTimeout = window.setTimeout(
    function() {
      updateProjectListFromCache();
      // indicate finish of filtered loading of the projects
      indicator.className = "";
    }, 500);
}

/**
 * Retrieve stack menu information from the back-end and
 * executes a callback on success.
 *
 * @param  {number}            project_id  ID of the project to retrieve
 * @param  {function(object)=} callback    Callback to receive the response
 *                                         stack information object.
 */
function getStackMenuInfo(project_id, callback) {
    requestQueue.register(django_url + project_id + '/stacks',
        'GET', undefined, function(status, text, xml) {
            if (status == 200 && text) {
                var e = $.parseJSON(text);
                if (e.error) {
                    alert(e.error);
                } else if (callback){
                    callback(e);
                }
            } else {
                alert("Sorry, the stacks for the current project couldn't be retrieved.");
            }
        });
}

/**
 * Update the displayed project list based on the cache
 * entries. This can involve a filter in the text box
 * "project_filter_text".
 */
function updateProjectListFromCache() {
  var matchingProjects = 0,
      searchString = $('#project_filter_text').val(),
      display,
      re = new RegExp(searchString, "i"),
      title,
      toappend,
      i, j, k,
      dt, dd, a, ddc,
      p,
      catalogueElement, catalogueElementLink,
      pp = document.getElementById("projects_dl");
  // remove all the projects
  while (pp.firstChild) pp.removeChild(pp.firstChild);
  updateProjectListMessage('');
  // add new projects according to filter
  for (i in cachedProjectsInfo) {
    p = cachedProjectsInfo[i];
    display = false;
    toappend = [];

    dt = document.createElement("dt");

    title = p.title;
    if (re.test(title)) {
      display = true;
    }
    dt.appendChild(document.createTextNode(p.title));

    document.getElementById("projects_h").style.display = "block";
    document.getElementById("project_filter_form").style.display = "block";
    toappend.push(dt);

    // add a link for every action (e.g. a stack link)
    for (j in p.action) {
      var sid_title = p.action[j].title;
      var sid_action = p.action[j].action;
      var sid_note = p.action[j].comment;
      dd = document.createElement("dd");
      a = document.createElement("a");
      ddc = document.createElement("dd");
      a.href = sid_action;
      if (re.test(sid_title)) {
        display = true;
      }
      a.appendChild(document.createTextNode(sid_title));
      dd.appendChild(a);
      toappend.push(dd);
      if (sid_note) {
        ddc = document.createElement("dd");
        ddc.innerHTML = sid_note;
        toappend.push(ddc);
      }
    }
    // optionally, add a neuron catalogue link
    if (p.catalogue) {
      catalogueElement = document.createElement('dd');
      catalogueElementLink = document.createElement('a');
      catalogueElementLink.href = django_url + p.pid;
      catalogueElementLink.appendChild(document.createTextNode('Browse the Neuron Catalogue'));
      catalogueElement.appendChild(catalogueElementLink);
      toappend.push(catalogueElement);
    }
    if (display) {
      ++ matchingProjects;
      for (k = 0; k < toappend.length; ++k) {
        pp.appendChild(toappend[k]);
      }
    }
  }
  if (cachedProjectsInfo.length === 0) {
    updateProjectListMessage("No CATMAID projects have been created");
  } else if (matchingProjects === 0) {
    updateProjectListMessage("No projects matched '"+searchString+"'");
  }
  project_menu.update(cachedProjectsInfo);
}

/*
 * Open a project and stack in a stack viewer, returning a promise yielding
 * the stack viewer.
 *
 * @param  {number|string} projectID   ID of the project to open. If different
 *                                     than the ID of the currently open
 *                                     project, it will be destroyed.
 * @param  {number} stackID            ID of the stack to open.
 * @param  {boolean} useExistingViewer True to add the stack to the existing,
 *                                     focused stack viewer.
 * @return {Promise}                   A promise yielding the stack viewer.
 */
function openProjectStack(projectID, stackID, useExistingViewer) {
  if (project && project.id != projectID) {
    project.destroy();
  }

  CATMAID.ui.catchEvents("wait");
  return new Promise(function (resolve, reject) {
    requestQueue.register(
      django_url + projectID + '/stack/' + stackID + '/info',
      'GET',
      undefined,
      CATMAID.jsonResponseHandler(
        function(json) {
          handle_openProjectStack(
                json,
                useExistingViewer ? project.focusedStackViewer : undefined)
              .then(resolve, reject);
        }, function(e) {
          reject();
          // Handle login errors
          if (e && e.permission_error) {
            new CATMAID.LoginDialog(e.error, realInit).show();
            return true;
          }
          return false;
        })
    );
  });
}

/**
 * Open a stack from a stack info API JSON response. Open the project or, if
 * already opened, add the stack to the opened project. If not opening a new
 * project, an existing stack viewer can be specified to receive the stack.
 *
 * @param  {Object} e                JSON response from the stack info API.
 * @param  {StackViewer} stackViewer Viewer to which to add the stack.
 * @return {Promise}                 A promise yielding the stack viewer
 *                                   containing the new stack.
 */
function handle_openProjectStack( e, stackViewer )
{
  // If the stack's project is not the opened project, replace it.
  if (!(project && project.id == e.pid)) {
    project = new CATMAID.Project(e.pid);
    project.register();
    // Update all datastores to reflect the active project before triggering
    // any events. This is necessary so that settings are correct when
    // updating for the project change.
    return CATMAID.DataStoreManager.reloadAll().then(function () {
      CATMAID.Init.trigger(CATMAID.Init.EVENT_PROJECT_CHANGED, project);
      return loadStack(e);
    });
  } else {
    return Promise.resolve(loadStack(e, stackViewer));
  }

  function loadStack(e, stackViewer) {
    var useExistingViewer = typeof stackViewer !== 'undefined';
    var labelupload = '';

    if( e.hasOwnProperty('labelupload_url') && e.tile_source_type === 2 ) {
      labelupload = e.labelupload_url;
    }

    var tilesource = CATMAID.getTileSource(e.tile_source_type,
        e.image_base, e.file_extension, e.tile_width, e.tile_height);

    var stack = new CATMAID.Stack(
        e.sid,
        e.stitle,
        e.dimension,
        e.resolution,
        e.translation,    //!< @todo replace by an affine transform
        e.broken_slices,
        e.num_zoom_levels,
        -2,
        labelupload, // TODO: if there is any
        e.metadata,
        e.orientation,
        tilesource );

    if (!useExistingViewer) {
      stackViewer = new CATMAID.StackViewer(project, stack);
    }

    document.getElementById( "toolbox_project" ).style.display = "block";

    var tilelayerConstructor = CATMAID.TileLayer.Settings.session.prefer_webgl ?
        CATMAID.PixiTileLayer :
        CATMAID.TileLayer;
    var tilelayer = new tilelayerConstructor(
        stackViewer,
        "Image data (" + stack.title + ")",
        stack,
        tilesource,
        true,
        1,
        !useExistingViewer,
        CATMAID.TileLayer.Settings.session.linear_interpolation);

    if (!useExistingViewer) {
      stackViewer.addLayer( "TileLayer", tilelayer );

      $.each(e.overlay, function(key, value) {
        var tilesource = CATMAID.getTileSource( value.tile_source_type,
            value.image_base, value.file_extension, value.tile_width, value.tile_height );
        var layer_visibility = parseInt(value.default_opacity) > 0;
        var tilelayer2 = new tilelayerConstructor(
                stackViewer,
                value.title,
                stack,
                tilesource,
                layer_visibility,
                value.default_opacity / 100,
                false);
        stackViewer.addLayer( value.title, tilelayer2 );
      });

      project.addStackViewer( stackViewer );

      // refresh the overview handler to also register the mouse events on the buttons
      stackViewer.tilelayercontrol.refresh();
    } else {
      stackViewer.addStackLayer(stack, tilelayer);
    }

    /* Update the projects stack menu. If there is more
    than one stack linked to the current project, a submenu for easy
    access is generated. */
    stack_menu.update();
    getStackMenuInfo(project.id, function(stacks) {
      if (stacks.length > 1)
      {
        var stack_menu_content = [];
        stacks.forEach(function(s) {
          stack_menu_content.push({
              id: s.id,
              title: s.title,
              note: '',
              action: [{
                  title: 'Open in new viewer',
                  note: '',
                  action: openProjectStack.bind(window, s.pid, s.id, false)
                },{
                  title: 'Add to focused viewer',
                  note: '',
                  action: openProjectStack.bind(window, s.pid, s.id, true)
                }
              ]
            }
          );
        });

        stack_menu.update( stack_menu_content );
        var stackMenuBox = document.getElementById( "stackmenu_box" );
        stackMenuBox.firstElementChild.lastElementChild.style.display = "none";
        stackMenuBox.style.display = "block";
      }
    });

    CATMAID.ui.releaseEvents();
    return stackViewer;
  }
}

/**
 * Open the given a specific stack group in a project.
 *
 * @param  {number}    pid       ID of the project to open.
 * @param  {number}    sgid      ID of the stack group to open.
 * @param  {function=} successFn Callback on success (unused).
 */
function openStackGroup(pid, sgid, successFn) {
  CATMAID.fetch(pid + "/stackgroup/" + sgid + "/info", "GET")
    .then(function(json) {
      if (!json.stacks || 0 === json.stacks.length) {
        // If a stack group has no stacks associated, cancel loading.
        CATMAID.error("The selected stack group has no stacks associated",
            "Canceling loading");
        return;
      }

      if (project) {
        project.destroy();
      }

      // Open first stack
      loadNextStack(json.project_id, json.stacks.shift(), json.stacks);

      function loadNextStack(pid, stack, stacks, firstStackViewer) {
        CATMAID.fetch(pid + '/stack/' + stack.id + '/info', 'GET')
          .then(function(json) {
            var stackViewer;
            // If there is already a stack loaded and this stack is a channel of
            // the group, add it to the existing stack viewer. Otherwise, open
            // the stack in a new stack viewer.
            if (firstStackViewer && 'has_channel' === stack.relation) {
              stackViewer = firstStackViewer;
            }
            handle_openProjectStack(json, stackViewer).then(function (newStackViewer) {
              if (0 < stacks.length) {
                var sv = firstStackViewer ? firstStackViewer : newStackViewer;
                loadNextStack(pid, stacks.shift(), stacks, sv);
              } else {
                CATMAID.layoutStackViewers();
              }
            });
          })
          .catch(function(error) {
            CATMAID.error("Couldn't load stack of stack group: " + error.error,
                error.detail);
          });
      }
    })
    .catch(function(error) {
      CATMAID.error("Couldn't load stack group: " + error.error, error.detail);
    });
}

/**
 * Layout currently open stack viewers. Currently, this only changes the layout
 * if there are three ortho-views present.
 */
CATMAID.layoutStackViewers = function() {
  var stackViewers = project.getStackViewers();
  var orientations = stackViewers.reduce(function(o, s) {
    o[s.primaryStack.orientation] = s;
    return o;
  }, {});

  // If there are three different ortho stacks, arrange viewers in four-pane
  // layout. On the left side XY on top of XZ, on the righ ZY on top of a
  // selection table.
  var Stack = CATMAID.Stack;
  if (3 === stackViewers.length && orientations[Stack.ORIENTATION_XY] &&
      orientations[Stack.ORIENTATION_XZ] && orientations[Stack.ORIENTATION_ZY]) {
    // Test if a fourth window has to be created
    var windows = rootWindow.getWindows();
    if (3 === windows.length) {
      // Create fourth window for nicer layout
      WindowMaker.create('keyboard-shortcuts');
    } else if (4 < windows.length) {
      // Stop layouting if there are more than four windows
      return;
    }

    // Get references to stack viewer windows
    var xyWin = orientations[Stack.ORIENTATION_XY].getWindow();
    var xzWin = orientations[Stack.ORIENTATION_XZ].getWindow();
    var zyWin = orientations[Stack.ORIENTATION_ZY].getWindow();

    // Find fourth window
    var extraWin = rootWindow.getWindows().filter(function(w) {
      return w !== xyWin && w !== xzWin && w !== zyWin;
    });

    // Raise error if there is more than one extra window
    if (1 !== extraWin.length) {
      throw CATMAID.Error("Couldn't find extra window for layouting");
    }

    // Arrange windows in four-pane layout
    var left = new CMWVSplitNode(xyWin, xzWin);
    var right = new CMWVSplitNode(zyWin, extraWin[0]);
    rootWindow.replaceChild(new CMWHSplitNode(left, right));
  }
};

/**
 * Check if the client CATMAID version matches the server version. If it does
 * not, disruptively prompt the user to refresh.
 */
CATMAID.Init.checkVersion = function () {
    requestQueue.register(django_url + 'version', 'GET', undefined,
        CATMAID.jsonResponseHandler(function(data) {
          if (CATMAID.CLIENT_VERSION !== data.SERVER_VERSION) {
            new CATMAID.ErrorDialog("Your version of CATMAID is different " +
                "from the server's version. Please refresh your browser " +
                "immediately to update to the server's version. Continuing to " +
                "use a different version than the server can cause " +
                "unintended behavior and data loss.",
                'Client version: ' + CATMAID.CLIENT_VERSION + '; ' +
                'Server version: ' + data.SERVER_VERSION).show();
          }

          window.setTimeout(CATMAID.Init.checkVersion, CATMAID.Init.CHECK_VERSION_TIMEOUT_INTERVAL);
        }, function () {
          window.setTimeout(CATMAID.Init.checkVersion, CATMAID.Init.CHECK_VERSION_TIMEOUT_INTERVAL);
          CATMAID.statusBar.replaceLast('Unable to check version (network may be disconnected).');
          return true;
        }));
};
window.setTimeout(CATMAID.Init.checkVersion, CATMAID.Init.CHECK_VERSION_TIMEOUT_INTERVAL);

/**
 * Check if there are new messages for the current user.
 */
var check_messages = (function() {

  // The date of the last unread message
  var latest_message_date = null;

  return function() {
    requestQueue.register(django_url + 'messages/latestunreaddate', 'GET',
        undefined, CATMAID.jsonResponseHandler(function(data) {
          // If there is a newer latest message than we know of, get all
          // messages to display them in the message menu and widget.
          if (data.latest_unread_date) {
            if (!latest_message_date || latest_message_date < data.latest_unread_date) {
              // Save the date and get all messages
              latest_message_date = data.latest_unread_date;
              get_messages();
              return;
            }
          }

          // Check again later
          msg_timeout = window.setTimeout(check_messages, MSG_TIMEOUT_INTERVAL);
        }, function () {
          msg_timeout = window.setTimeout(check_messages, MSG_TIMEOUT_INTERVAL);
          CATMAID.statusBar.replaceLast('Unable to check for messages (network may be disconnected).');
          return true;
        }));
  };
})();

/**
 * Retrieve user messages.
 */
function get_messages() {
  requestQueue.register(django_url + 'messages/list', 'GET', undefined, handle_message);
}

/**
 * Handle use message request response.
 *
 * @param  {number}    status             XHR response status.
 * @param  {string}    text               XHR response content.
 * @param  {Object}    xml                XHR response XML (unused).
 */
function handle_message( status, text, xml )
{
  if ( !session )
    return;

  if ( status == 200 && text )
  {
    var e = JSON.parse(text);
    if ( e.error )
    {
      alert( e.error );
    }
    else
    {
      var message_container = document.getElementById( "message_container" );
      if ( !( typeof message_container === "undefined" || message_container === null ) )
      {
        //! remove old messages
        while ( message_container.firstChild ) message_container.removeChild( message_container.firstChild );

        //! add new messages
        var n = 0;
        for ( var i in e )
        {
          if (e [ i ].id == -1) {
            var notifications_count = e [ i ].notification_count;
            var notifications_button_img = $('#data_button_notifications_img');
            if (notifications_button_img !== undefined) {
              if (notifications_count > 0)
                notifications_button_img.attr('src', STATIC_URL_JS + 'images/table_notifications_open.svg');
              else
                notifications_button_img.attr('src', STATIC_URL_JS + 'images/table_notifications.svg');
            }

            delete e [ i ];
          } else {
            var timeFormatted = (new Date(e[i].time)).toLocaleString();
            e[ i ].action = django_url + 'messages/mark_read?id=' + e[ i ].id;
            e[ i ].note = timeFormatted;
            ++n;
            var dt = document.createElement( "dt" );
            dt.appendChild( document.createTextNode( timeFormatted ) );
            var dd1 = document.createElement( "dd" );
            var dd1a = document.createElement( "a" );
            dd1a.href = e[ i ].action;
            dd1a.target = '_blank';
            dd1a.appendChild( document.createTextNode( e[ i ].title ) );
            dd1.appendChild( dd1a );
            var dd2 = document.createElement( "dd" );
            dd2.innerHTML = e[ i ].text;
            message_container.appendChild( dt );
            message_container.appendChild( dd1 );
            message_container.appendChild( dd2 );
          }
        }
        message_menu.update( e );
        // Make all message links open in a new page
        var links = message_menu.getView().querySelectorAll('a');
        for (var j=0; j<links.length; ++j) {
          links[j].target = '_blank';
        }
        if ( n > 0 ) document.getElementById( "message_menu_text" ).className = "alert";
        else document.getElementById( "message_menu_text" ).className = "";
      }

    }
  }

  msg_timeout = window.setTimeout( check_messages, MSG_TIMEOUT_INTERVAL );
}

/**
 * Mark a message as read
 *
 * @param  {number} id ID of the message to mark as read.
 */
function read_message(id) {
  requestQueue.register(django_url + 'messages/mark_read', 'POST', {
    id: id
  }, null);
}

/**
 * Retrieve data views.
 */
function dataviews() {
  requestQueue.register(django_url + 'dataviews/list', 'GET', undefined, handle_dataviews);
}

function handle_dataviews(status, text, xml) {
  if ( status == 200 && text )
  {
    var e = JSON.parse(text);
    if ( e.error )
    {
      alert( e.error );
    }
    else
    {
      // a function for creating data view menu handlers
      var create_handler = function( id, code_type ) {
        return function() {
          // close any open project and its windows
          rootWindow.closeAllChildren();
          // open data view
          switch_dataview( id, code_type );
        };
      };
      /* As we want to handle a data view change in JS,
       * a function is added as action for all the menu
       * elements. Also add small links to each menu entry
       * as comment.
       */
      for ( var i in e )
      {
        e[i].action = create_handler( e[i].id,
          e[i].code_type );
        var link = '<a class="hoverlink" href="' + django_url +
          '?dataview=' + e[i].id + '">&para;&nbsp;</a>';
        e[i].note = link + e[i].note;
      }

      dataview_menu.update( e );
    }
  }
}

function switch_dataview( view_id, view_type ) {
  /* Some views are dynamic, e.g. the plain list view offers a
   * live filter of projects. Therefore we treat different types
   * of dataviews differently and need to know whether the
   * requested view is a legacy view.
   */
  var do_switch_dataview = function( view_id, view_type ) {
    if ( view_type == "legacy_project_list_data_view" ) {
      // Show the standard plain list data view
      document.getElementById("data_view").style.display = "none";
      document.getElementById("clientside_data_view").style.display = "block";
      updateProjectListFromCache();
    } else {
      // let Django render the requested view and display it
      document.getElementById("clientside_data_view").style.display = "none";
      document.getElementById("data_view").style.display = "block";
      load_dataview( view_id );
    }
  };

  /* If view type is passed, switch to the data view directly.
   * Otherwise, retrieve the data view type first.
   */
  if (view_type) {
    do_switch_dataview(view_id, view_type);
  } else {
    requestQueue.register(django_url + 'dataviews/type/' + view_id,
      'GET', undefined, function(status, text, xml) {
        if (status == 200 && text) {
          var e = $.parseJSON(text);
          if (e.error) {
            alert(e.error);
          } else {
            do_switch_dataview(view_id, e.type);
          }
        } else {
          alert("A problem occurred while retrieving data view information.");
        }
    });
  }
}

/**
 * Load the default data view.
 */
function load_default_dataview() {
  requestQueue.register(django_url + 'dataviews/default',
    'GET', undefined, handle_load_default_dataview);
}

function handle_load_default_dataview(status, text, xml) {
  if ( status == 200 && text )
  {
    var e = JSON.parse(text);
    if ( e.error )
    {
      alert( e.error );
    }
    else
    {
        switch_dataview( e.id, e.code_type );
    }
  }
}

/**
 * Load a specific data view.
 */
function load_dataview( view_id ) {
  requestQueue.register(django_url + 'dataviews/show/' + view_id,
    'GET', undefined, handle_load_dataview);
}

function handle_load_dataview(status, text, xml) {
  var data_view_container = document.getElementById("data_view");

  if ( !( typeof data_view_container === "undefined" || data_view_container === null ) )
  {
    //! remove old content
    while ( data_view_container.firstChild )
    {
      data_view_container.removeChild( data_view_container.firstChild );
    }

    // put content into data view div
    if ( status == 200 && text )
    {
      //! add new content
      data_view_container.innerHTML = text;
      $("img.lazy", data_view_container).lazyload({
        container: $(data_view_container)
      });
    } else {
      // create error message
      var error_paragraph = document.createElement( "p" );
      data_view_container.appendChild( error_paragraph );
      error_paragraph.appendChild( document.createTextNode(
        "Sorry, there was a problem loading the requested data view." ) );
      // create new error iframe
      var error_iframe = document.createElement( "iframe" );
      error_iframe.style.width = "100%";
      error_iframe.style.height = "400px";
      data_view_container.appendChild( error_iframe );
      error_iframe.contentDocument.write( text );
    }
  }
}

/**
 * Initialize CATMAID.
 *
 * Check browser capabilities.
 * Parse deep link from the URL if necessary.
 * Setup UI and windowing system.
 *
 * Called by the onload-handler of document.body.
 */
var realInit = function()
{
  // If the browser supports everything but webgl, let the user dismiss the warning message
  if (Modernizr.opacity && Modernizr.canvas && Modernizr.svg && Modernizr.json)
  {
    $('#browser_unsupported .message').append($('<p><a href="#">Dismiss<a/></p>').click(function () {
      $('#browser_unsupported').hide();
    }));
  }

  // If promises are missing, load a polyfill then try to init again.
  if (!Modernizr.promises)
  {
    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = STATIC_URL_JS + 'libs/promise-polyfill/es6-promise-2.0.1.min.js';
    script.onload = function () {
      window.ES6Promise.polyfill();
      Modernizr.promises = true;
      realInit();
    };
    document.head.appendChild(script);
    return;
  }

  //! analyze the URL
  var pid;
  var sids = [];
  var ss = [];
  var inittool;
  var z;
  var y;
  var x;
  var s;
  var zp;
  var yp;
  var xp;
  var init_active_node_id;
  var init_active_skeleton;
  var singleStackViewer = false;

  var account;
  var password;

  var values = CATMAID.tools.parseQuery(window.location.search);
  if ( values )
  {
    // simply parse the fragment values
    // @todo take care for the values proper range
    if ( values[ "z" ] ) z = parseInt( values[ "z" ] );
    if ( isNaN( z ) ) z = undefined;
    if ( values[ "y" ] ) y = parseInt( values[ "y" ] );
    if ( isNaN( y ) ) y = undefined;
    if ( values[ "x" ] ) x = parseInt( values[ "x" ] );
    if ( isNaN( x ) ) x = undefined;
    if ( values[ "s" ] ) s = parseFloat( values[ "s" ] );
        if ( isNaN( s ) ) s = undefined;
        if ( values[ "active_skeleton_id" ] ) init_active_skeleton = parseInt( values[ "active_skeleton_id" ] );
        if ( values[ "active_node_id" ] ) init_active_node_id = parseInt( values[ "active_node_id" ] );

    if ( !(
        typeof z == "undefined" ||
        typeof y == "undefined" ||
        typeof x == "undefined" ||
        typeof s == "undefined" ) )
    {
      pid = 1;
      sids = [];
      sids[ 0 ] = 1;
      ss = [];
      ss[ 0 ] = 1;
    }
    else
    {
      if ( values[ "pid" ] ) pid = values[ "pid" ];
      if ( values[ "zp" ] ) zp = parseInt( values[ "zp" ] );
      if ( isNaN( zp ) ) zp = undefined;
      if ( values[ "yp" ] ) yp = parseInt( values[ "yp" ] );
      if ( isNaN( yp ) ) yp = undefined;
      if ( values[ "xp" ] ) xp = parseInt( values[ "xp" ] );
      if ( isNaN( xp ) ) xp = undefined;
      if ( values[ "tool" ] ) inittool = values[ "tool"];

      for ( var i = 0; values[ "sid" + i ]; ++i )
      {
        var sid = values[ "sid" + i ];
        // Make sure a stack isn't opened multiple times
        if ( -1 !== sids.indexOf( sid ) ) {
          continue;
        }
        sids.push( sid );
        if ( values[ "s" + i ] )
          ss.push( parseFloat( values[ "s" + i ] ) );
        else
          ss.push( NaN );
        if ( isNaN( ss[ i ] ) )
        {
          sids.pop();
          ss.pop();
        }
      }
    }

    if ( values[ "account" ] && values[ "password" ] )
    {
      account = values[ "account" ];
      password = values[ "password" ];
    }

    // find data view setting
    if ( values[ "dataview" ] )
      current_dataview = parseInt( values["dataview"] );
    if ( isNaN( current_dataview ) ) current_dataview = undefined;

    // Check if only one stack viewer should be used for all stacks
    if ( values[ "composite" ] ) {
      singleStackViewer = ("1" === values["composite"]);
    }
  }

  CATMAID.statusBar = new CATMAID.Console();
  document.body.appendChild( CATMAID.statusBar.getView() );

  var a_url = document.getElementById( "a_url" );
  a_url.onmouseover = function( e )
  {
    this.href = project.createURL();
    return true;
  };

  document.getElementById( "login_box" ).style.display = "block";
  document.getElementById( "logout_box" ).style.display = "none";
  document.getElementById( "session_box" ).style.display = "none";

  // Create the toolboxes
  $('#toolbox_project').replaceWith(CATMAID.createButtonsFromActions(
    CATMAID.toolActions, 'toolbox_project', ''));
  $('#toolbox_edit').replaceWith(CATMAID.createButtonsFromActions(
    CATMAID.EditTool.actions, 'toolbox_edit', ''));
  $('#toolbox_segmentation').replaceWith(CATMAID.createButtonsFromActions(
    CATMAID.SegmentationTool.actions, 'toolbox_segmentation', ''));
  $('#toolbox_data').replaceWith(CATMAID.createButtonsFromActions(
    CATMAID.TracingTool.actions, 'toolbox_data', ''));

  // Add the toolbar buttons:
  document.getElementById( "toolbar_nav" ).style.display = "none";
  document.getElementById( "toolbar_text" ).style.display = "none";
  document.getElementById( "toolbar_tags" ).style.display = "none";
  document.getElementById( "toolbar_roi" ).style.display = "none";
  document.getElementById( "toolbox_project" ).style.display = "none";
  document.getElementById( "toolbox_edit" ).style.display = "none";
  document.getElementById( "toolbox_ontology" ).style.display = "none";
  document.getElementById( "toolbox_data" ).style.display = "none";
  document.getElementById( "toolbox_segmentation" ).style.display = "none";
  document.getElementById( "toolbox_show" ).style.display = "none";

  document.getElementById( "account" ).onkeydown = login_oninputreturn;
  document.getElementById( "password" ).onkeydown = login_oninputreturn;

  dataview_menu = new Menu();
  document.getElementById( "dataview_menu" ).appendChild( dataview_menu.getView() );
  dataviews();

  project_menu = new Menu();
  document.getElementById( "project_menu" ).appendChild( project_menu.getView() );

  stack_menu = new Menu();
  document.getElementById( "stack_menu" ).appendChild( stack_menu.getView() );

  message_menu = new Menu();
  document.getElementById( "message_menu" ).appendChild( message_menu.getView() );

  user_menu = new Menu();
  document.getElementById( "user_menu" ).appendChild( user_menu.getView() );

  // login and thereafter load stacks if requested
  login(undefined, undefined, function() {
    var tools = {
      navigator: CATMAID.Navigator,
      tracingtool: CATMAID.TracingTool,
      segmentationtool: CATMAID.SegmentationTool,
      classification_editor: null
    };

    loadStacksFromURL(singleStackViewer);

    // Open stacks one after another and move to the requested location. Load
    // the requested tool after everything has been loaded.
    function loadStacksFromURL(composite, loaded) {
      loaded = loaded || 0;
      useExistingStackViewer = composite && (loaded > 0);
      if (pid) {
        if (sids.length > 0) {
          // Open stack and queue test/loading for next one
          var sid = sids.shift();
          var s = ss.shift();
          openProjectStack(pid, sid, useExistingStackViewer).then(function() {
            // Moving every stack is not really necessary, but for now a
            // convenient way to apply the requested scale to each stack.
            if (typeof zp == "number" && typeof yp == "number" &&
                typeof xp == "number" && typeof s == "number" ) {
              project.moveTo(zp, yp, xp, s, function() {
                // Load next stack
                loadStacksFromURL(composite, loaded + 1);
              });
            }
          });
        } else {
          // Set the tool only after the move; otherwise, thousands of skeleton
          // nodes may be fetched and painted unnecessarily.
          var tool = tools[inittool];
          if (tool) {
            project.setTool(new tool());
          }
          if (init_active_node_id) {
            // initialization hack
            SkeletonAnnotations.init_active_node_id = init_active_node_id;
          }
        }
      }
    }
  });

  // the text-label toolbar

  var input_fontsize = new Input( "fontsize", 3, function( e ){ return true; }, 32 );
  document.getElementById( "input_fontsize" ).appendChild( input_fontsize.getView() );
  var input_fontcolourred = new Input( "fontcolourred", 3, function( e ){ return true; }, 255 );
  document.getElementById( "input_fontcolourred" ).appendChild( input_fontcolourred.getView() );
  var input_fontcolourgreen = new Input( "fontcolourgreen", 3, function( e ){ return true; }, 127 );
  document.getElementById( "input_fontcolourgreen" ).appendChild( input_fontcolourgreen.getView() );
  var input_fontcolourblue = new Input( "fontcolourblue", 3, function( e ){ return true; }, 0 );
  document.getElementById( "input_fontcolourblue" ).appendChild( input_fontcolourblue.getView() );

  rootWindow = new CMWRootNode();
  CATMAID.ui.registerEvent( "onresize", resize );

  // change global bottom bar height, hide the copyright notice
  // and move the statusBar
  CATMAID.statusBar.setBottom();

  window.onresize();

  console.log('CATMAID (Client version ' + CATMAID.CLIENT_VERSION + ')\n' +
              'For help interacting with CATMAID from the console see:\n' +
              'https://github.com/catmaid/CATMAID/wiki/Scripting');
};

/**
 * Resize the main content and root window.
 *
 * Called by the window.onresize event.
 */
var resize = function( e )
{
  var top = document.getElementById( "toolbar_container" ).offsetHeight;
  var height = Math.max( 0, CATMAID.ui.getFrameHeight() - top - global_bottom );
  var width = CATMAID.ui.getFrameWidth();

  var content = document.getElementById( "content" );
  content.style.top = top + "px";
  content.style.width = width + "px";
  content.style.height = height + "px";

  rootFrame = rootWindow.getFrame();
  rootFrame.style.top = top + "px";
  rootFrame.style.width = CATMAID.UI.getFrameWidth() + "px";
  rootFrame.style.height = height + "px";

  rootWindow.redraw();

  return true;
};

var showMessages = (function()
{
  // A reference to the currently displayed message window (if any)
  var messageWindow = null;

  return function() {
    if ( !messageWindow )
    {
      messageWindow = new CMWWindow( "Messages" );
      var messageContent = messageWindow.getFrame();
      messageContent.style.backgroundColor = "#ffffff";
      var messageContext = document.getElementById( "message_context" );
      if ( messageContext.parentNode )
        messageContext.parentNode.removeChild( messageContext );
      messageContent.appendChild( messageContext );

      messageWindow.addListener(
        function( callingWindow, signal )
        {
          switch ( signal )
          {
          case CMWWindow.CLOSE:
            if ( messageContext.parentNode )
              messageContext.parentNode.removeChild( messageContext );
            document.getElementById( "dump" ).appendChild( messageContext );
            if ( typeof project === "undefined" || project === null )
            {
              rootWindow.close();
              document.getElementById( "content" ).style.display = "block";
            }
            messageWindow = null;
            break;
          case CMWWindow.RESIZE:
            messageContext.style.height = messageWindow.getContentHeight() + "px";
            break;
          }
          return true;
        } );

      /* be the first window */
      if ( rootWindow.getFrame().parentNode != document.body )
      {
        document.body.appendChild( rootWindow.getFrame() );
        document.getElementById( "content" ).style.display = "none";
      }

      if ( rootWindow.getChild() === null )
        rootWindow.replaceChild( messageWindow );
      else
        rootWindow.replaceChild( new CMWVSplitNode( messageWindow, rootWindow.getChild() ) );
    }

    messageWindow.focus();
  };

})();
