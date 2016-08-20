/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */
/* global
  CATMAID,
  Arbor,
  error,
  fetchSkeletons,
  InstanceRegistry,
  project,
  requestQueue,
  SkeletonAnnotations,
  SkeletonRegistry,
  submitterFn,
  SynapseClustering,
  WindowMaker
 */

(function(CATMAID) {

  "use strict";

  /* Only methods of the WebGLApplication object elicit a render. All other methods
   * do not, except for those that use continuations to load data (meshes) or to
   * compute with web workers (betweenness centrality shading). */
  var WebGLApplication = function() {
    this.widgetID = this.registerInstance();
    this.registerSource();
    this.APPEND_WARNING_THRESHOLD = 1000;
    // Indicates whether init has been called
    this.initialized = false;
    // Indicates if there is an animation running
    this.animationRequestId = undefined;
    // The current animation, if any
    this.animation = undefined;
    // Map loaed volume IDs to an array of Three.js meshes
    this.loadedVolumes = {};
    // Current set of filtered connectors (if any)
    this.filteredConnectors = null;

    // Listen to changes of the active node
    SkeletonAnnotations.on(SkeletonAnnotations.EVENT_ACTIVE_NODE_CHANGED,
      this.staticUpdateActiveNodePosition, this);

    CATMAID.Nodes.on(CATMAID.Nodes.EVENT_NODE_RADIUS_CHANGED,
        this.handleRadiusChange, this);
  };

  WebGLApplication.prototype = {};
  $.extend(WebGLApplication.prototype, new InstanceRegistry());
  $.extend(WebGLApplication.prototype, new CATMAID.SkeletonSource());

  WebGLApplication.prototype.init = function(canvasWidth, canvasHeight, divID) {
    if (this.initialized) {
      return;
    }
    this.divID = divID;
    this.container = document.getElementById(divID);
    this.submit = new submitterFn();
    this.options = new WebGLApplication.prototype.OPTIONS.clone();
    this.space = new this.Space(canvasWidth, canvasHeight, this.container, project.focusedStackViewer.primaryStack, this.options);
    this.updateActiveNodePosition();
    project.on(CATMAID.Project.EVENT_STACKVIEW_FOCUS_CHANGED, this.adjustStaticContent, this);
    project.on(CATMAID.Project.EVENT_LOCATION_CHANGED, this.handlelLocationChange, this);
    this.initialized = true;
  };

  // Store views in the prototype to make them available for all intances.
  WebGLApplication.prototype.availableViews = {};

  WebGLApplication.prototype.getName = function() {
    return "3D View " + this.widgetID;
  };

  WebGLApplication.prototype.destroy = function() {
    SkeletonAnnotations.off(SkeletonAnnotations.EVENT_ACTIVE_NODE_CHANGED,
        this.staticUpdateActiveNodePosition, this);
    CATMAID.Nodes.off(CATMAID.Nodes.EVENT_NODE_RADIUS_CHANGED,
        this.handleRadiusChange, this);
    project.off(CATMAID.Project.EVENT_STACKVIEW_FOCUS_CHANGED, this.adjustStaticContent, this);
    project.off(CATMAID.Project.EVENT_LOCATION_CHANGED, this.handlelLocationChange, this);
    this.stopAnimation();
    this.unregisterInstance();
    this.unregisterSource();
    this.space.destroy();
    CATMAID.NeuronNameService.getInstance().unregister(this);
    Object.keys(this).forEach(function(key) { delete this[key]; }, this);
  };

  WebGLApplication.prototype.updateModels = function(models) {
    this.append(models);
  };

  WebGLApplication.prototype.getSelectedSkeletons = function() {
    var skeletons = this.space.content.skeletons;
    return Object.keys(skeletons).filter(function(skid) { return skeletons[skid].visible; }).map(Number);
  };

  WebGLApplication.prototype.getSkeletonModel = function(skeleton_id) {
    if (skeleton_id in this.space.content.skeletons) {
      return this.space.content.skeletons[skeleton_id].skeletonmodel.clone();
    }
    return null;
  };

  WebGLApplication.prototype.getSkeletonModels = function() {
    var skeletons = this.space.content.skeletons;
    return Object.keys(skeletons).reduce(function(m, skid) {
      var skeleton = skeletons[skid];
      m[skid] = skeleton.skeletonmodel.clone();
      return m;
    }, {});
  };

  WebGLApplication.prototype.getSelectedSkeletonModels = function() {
    var skeletons = this.space.content.skeletons;
    return Object.keys(skeletons).reduce(function(m, skid) {
      var skeleton = skeletons[skid];
      if (skeleton.visible) {
        m[skid] = skeleton.skeletonmodel.clone();
      }
      return m;
    }, {});
  };

  WebGLApplication.prototype.highlight = function(skeleton_id) {
     // Do nothing, for now
  };

  WebGLApplication.prototype.resizeView = function(w, h) {
    if (!this.space) {
      // WebGLView has not been initialized, can't resize!
      return;
    }

    var canvasWidth = w,
        canvasHeight = h;

    if (!THREEx.FullScreen.activated()) {
      $('#view_in_3d_webgl_widget' + this.widgetID).css('overflowY', 'hidden');
      if(isNaN(h) && isNaN(w)) {
        canvasHeight = 800;
        canvasWidth = 600;
      }

      // use 4:3
      if (isNaN(h)) {
        canvasHeight = canvasWidth / 4 * 3;
      } else if (isNaN(w)) {
        canvasHeight = canvasHeight - 100;
        canvasWidth = canvasHeight / 3 * 4;
      }

      if (canvasWidth < 80 || canvasHeight < 60) {
        canvasWidth = 80;
        canvasHeight = 60;
      }

      $('#viewer-3d-webgl-canvas' + this.widgetID).width(canvasWidth);
      $('#viewer-3d-webgl-canvas' + this.widgetID).height(canvasHeight);
      $('#viewer-3d-webgl-canvas' + this.widgetID).css("background-color", "#000000");

      this.space.setSize(canvasWidth, canvasHeight, this.options);

      this.space.render();
    }
  };

  WebGLApplication.prototype.fullscreenWebGL = function() {
    if (THREEx.FullScreen.activated()){
      THREEx.FullScreen.cancel();
    } else {
      THREEx.FullScreen.request(document.getElementById('viewer-3d-webgl-canvas' + this.widgetID));
      var w = window.innerWidth, h = window.innerHeight;
      this.resizeView( w, h );
    }
    this.space.render();
  };


  /**
   * Show a dialog to ask the user for image dimensions, resize the view to the
   * new dimensions,execute the given function and return to the original
   * dimension afterwards.
   */
  WebGLApplication.prototype.askForDimensions = function(title, fn, block) {
    var dialog = new CATMAID.OptionsDialog(title);
    dialog.appendMessage("Please adjust the dimensions to your liking. They " +
        "default to the current size of the 3D viewer");
    var imageWidthField = dialog.appendField("Image width (px): ",
        "image-width", this.space.canvasWidth);
    var imageHeightField = dialog.appendField("Image height (px): ",
        "image-height", this.space.canvasHeight);

    dialog.onOK = handleOK.bind(this);
    dialog.show(350, "auto", true);

    function handleOK() {
      /* jshint validthis: true */ // `this` is bound to this WebGLApplication
      if (block) {
        $.blockUI({message: '<img src="' + CATMAID.staticURL +
            'images/busy.gif" /> <span>Please wait</span>'});
      }

      var originalWidth, originalHeight;
      try {
        var width = parseInt(imageWidthField.value);
        var height = parseInt(imageHeightField.value);

        if (!width || !height) {
          throw new CATMAID.ValueError("Please use valid width and height values");
        }

        // Save current dimensions and set new ones, if available
        if (width !== this.space.canvasWidth || height !== this.space.canvasHeight) {
          originalWidth = this.space.canvasWidth;
          originalHeight = this.space.canvasHeight;
          this.resizeView(width, height);
        } else {
          this.space.render();
        }

        // Call passed in function
        if (CATMAID.tools.isFn(fn)) fn();
      } catch (e) {
        CATMAID.error("An error occurred", e);
      }

      // Restore original dimensions
      if (originalWidth && originalHeight) {
        this.resizeView(originalWidth, originalHeight);
      }

      if (block) {
        $.unblockUI();
      }
    }
  };


  /**
   * Store the current view as PNG image.
   */
  WebGLApplication.prototype.exportPNG = function() {
    this.askForDimensions("PNG export", (function() {
      try {
        /* jshint validthis: true */ // `this` is bound to this WebGLApplication
        var imageData = this.space.view.getImageData();
        var blob = CATMAID.tools.dataURItoBlob(imageData);
        CATMAID.info("The exported PNG will have a transparent background");
        saveAs(blob, "catmaid_3d_view.png");
      } catch(e) {
        CATMAID.error("Could not export current 3D view, there was an error: " + e,
            e.stack);
      }
    }).bind(this), true);
  };

  /**
   * Store the current view as SVG image.
   */
  WebGLApplication.prototype.exportSVG = function() {
    this.askForDimensions("SVG export", (function() {
      $.blockUI({message: '<img src="' + CATMAID.staticURL +
          'images/busy.gif" /> <span id="block-export-svg">Please wait</span>'});
      var label = $('#block-export-svg');
      label.text("Exporting SVG");

      // Queue individual steps as tasks to have better UI feedback. To give the
      // browser a chance to render progress messages, setTimeout() has to be
      // used instead of promises. The former queue an tasks and the latter
      // queue microtasks. Rendering happens only between tasks.
      var error = false, start, last;
      function queue(msg, fn) {
        var f = function() {
          if (msg) {
            // Update message and start task
            label.text(msg);
          }
          setTimeout(function() {
            if (error) return;
            try {
              fn();
              if (f.callback) {
                f.callback();
              }
            } catch (e) {
              $.unblockUI();
              error = true;
              CATMAID.error("Could not export current 3D view, there was an error: " + e,
                  e.stack);
            }
          }, 0);
        };

        // If there is no function queued yet, make this function the first. If
        // there is at least one function queued, run this function as a
        // callback of the last function.
        if (!start) {
          start = f;
        } else if (last) {
          last.callback = f;
        }
        // Make this function the last one added
        last = f;
      }

      var self = this, svg;
      queue("Rendering SVG", function() {
        svg = self.space.view.getSVGData();
      });

      queue("Postprocessing", function() {
          CATMAID.svgutil.reduceCoordinatePrecision(svg, 1);
          CATMAID.svgutil.stripStyleProperties(svg, {
            'fill': 'none',
            'stroke-opacity': 1,
            'stroke-linejoin': undefined
          });
          CATMAID.svgutil.reduceStylePrecision(svg, 1);
      });

      queue("Generating output", function() {
        var styleDict = CATMAID.svgutil.classifyStyles(svg);

        var styles = Object.keys(styleDict).reduce(function(o, s) {
          var cls = styleDict[s];
          o = o + "." + cls + "{" + s + "}";
          return o;
        }, "");

        var xml = $.parseXML(new XMLSerializer().serializeToString(svg));
        CATMAID.svgutil.addStyles(xml, styles);

        var data = new XMLSerializer().serializeToString(xml);
        var blob = new Blob([data], {type: 'text/svg'});
        saveAs(blob, "catmaid-3d-view.svg");
      });

      queue(false, function() {
        setTimeout($.unblockUI, 0);
      });

      // Start processing and give the browser a chance to render progress
      // information.
      setTimeout(start, 100);

    }).bind(this));
  };

  /**
   * Create an store a neuron catalog SVG for the current view.
   */
  WebGLApplication.prototype.exportCatalogSVG = function() {
    var dialog = new CATMAID.OptionsDialog("Catalog export options");
    dialog.appendMessage('Adjust the catalog export settings to your liking.');

    // Create a new empty neuron name service that takes care of the sorting names
    var ns = CATMAID.NeuronNameService.newInstance(true);
    var namingOptions = ns.getOptions();
    var namingOptionNames = namingOptions.map(function(o) { return o.name; });
    var namingOptionIds = namingOptions.map(function(o) { return o.id; });

    // Get available skeleton list sources
    var pinSourceOptions = CATMAID.skeletonListSources.createOptions();
    var pinSourceOptionNames = ["(None)"].concat(pinSourceOptions.map(function(o) { return o.text; }));
    var pinSourceOptionIds = ['null'].concat(pinSourceOptions.map(function(o) { return o.value; }));

    // Add options to dialog
    var columns = dialog.appendField("# Columns: ", "svg-catalog-num-columns", '2');
    var sorting = dialog.appendChoice("Sorting name: ", "svg-catalog-sorting",
        namingOptionNames, namingOptionIds);
    var pinSources = dialog.appendChoice("Skeletons to pin: ", "svg-catalog-pin-source",
        pinSourceOptionNames, pinSourceOptionIds);
    var displayNames = dialog.appendCheckbox('Display names', 'svg-catalog-display-names', true);
    var coordDigits = dialog.appendField("# Coordinate decimals", 'svg-catalog-coord-digits', '1');
    var fontsize = dialog.appendField("Fontsize: ", "svg-catalog-fontsize", '14');
    var margin = dialog.appendField("Margin: ", "svg-catalog-margin", '10');
    var padding = dialog.appendField("Padding: ", "svg-catalog-pading", '10');
    var title = dialog.appendField("Title: ", "svg-catalog-title", 'CATMAID neuron catalog');

    // Use change chandler of labeling select to ask user for annotations
    var labelingOption;
    $(sorting).on('change', function() {
      var newLabel = namingOptionIds[sorting.selectedIndex];
      if (newLabel === 'all-meta' || newLabel === 'own-meta') {
        // Ask for meta annotation
        var dialog = new CATMAID.OptionsDialog("Please enter meta annotation");
        var field = dialog.appendField("Meta annotation", 'meta-annotation',
            '', true);
        dialog.onOK = function() {
          labelingOption = field.value;
        };

        // Update all annotations before, showing the dialog
        CATMAID.annotations.update(function() {
          dialog.show();
          // Add auto complete to input field
          $(field).autocomplete({
            source: CATMAID.annotations.getAllNames()
          });
        });
      } else {
        labelingOption = undefined;
      }
    });

    dialog.onOK = handleOK.bind(this);

    dialog.show(400, 460, true);

    function handleOK() {
      /* jshint validthis: true */ // `this` is bound to this WebGLApplication
      $.blockUI();
      // Get models of exported skeletons
      var models = this.getSelectedSkeletonModels();
      // Configure labeling of name service
      var labelingId = namingOptionIds[sorting.selectedIndex];
      ns.addLabeling(labelingId, labelingOption);

      // Check if there are pinned skeletons that have to be loaded first
      var pinnedSkeletonModels = {};
      if (pinSources.selectedIndex > 0) {
        var srcId = pinSourceOptionIds[pinSources.selectedIndex];
        var src = CATMAID.skeletonListSources.getSource(srcId);
        pinnedSkeletonModels = src.getSelectedSkeletonModels();
      }
      var pinnedSkeletonIds = Object.keys(pinnedSkeletonModels);
      var addedPinnendSkeletons = pinnedSkeletonIds.filter(function(skid) {
        return !(skid in models);
      });

      // Fetch names for the sorting
      ns.registerAll(dialog, models, (function() {
        if (0 === addedPinnendSkeletons.length) {
          createSVG.call(this);
        } else {
          // Make sure all pinned skeletons are available in the 3D viewer
          this.addSkeletons(pinnedSkeletonModels, (function() {
            this.space.render();
            createSVG.call(this);
            // Remove all added pinned skeletons again
            this.removeSkeletons(addedPinnendSkeletons);
          }).bind(this));
        }
      }).bind(this));

      function createSVG() {
        try {
          // Build sorting name list
          var skeletonIds = Object.keys(models);
          var sortingNames = skeletonIds.reduce(function(o, skid) {
            var name = ns.getName(skid);
            if (!name) {
              throw "No valid name found for skeleton " + skid +
                  " with labeling " + labelingId +
                  labelingOption ? "(" + labelingOption + ")" : "";
            }
            o[skid] = name;
            return o;
          }, {});
          // Sort skeleton IDs based on the names
          skeletonIds.sort(function(a, b) {
            return sortingNames[a].localeCompare(sortingNames[b], 'en',
                {numeric: true});
          });

          // Collect options
          var options = {
            layout: 'catalog',
            columns: parseInt(columns.value),
            skeletons: skeletonIds,
            pinnedSkeletons: pinnedSkeletonIds,
            displaynames: Boolean(displayNames.checked),
            fontsize: parseFloat(fontsize.value),
            margin: parseInt(margin.value),
            padding: parseInt(padding.value),
            title: title.value,
          };

          // Export catalog
          var svg = this.space.view.getSVGData(options);
          var precision = parseInt(coordDigits.value);
          CATMAID.svgutil.reduceCoordinatePrecision(svg, precision);
          CATMAID.svgutil.stripStyleProperties(svg, {
            'fill': 'none',
            'stroke-opacity': 1,
            'stroke-linejoin': undefined
          });
          CATMAID.svgutil.reduceStylePrecision(svg, precision);

          var styleDict = CATMAID.svgutil.classifyStyles(svg);

          var styles = Object.keys(styleDict).reduce(function(o, s) {
            var cls = styleDict[s];
            o = o + "." + cls + "{" + s + "}";
            return o;
          }, "");

          var xml = $.parseXML(new XMLSerializer().serializeToString(svg));
          CATMAID.svgutil.addStyles(xml, styles);

          var data = new XMLSerializer().serializeToString(xml);
          var blob = new Blob([data], {type: 'text/svg'});
          saveAs(blob, "catmaid-neuron-catalog.svg");
        } catch (e) {
          CATMAID.error("Could not export neuron catalog. There was an error.", e);
        }
        $.unblockUI();
      }
    }
  };

  WebGLApplication.prototype.exportSkeletonsAsCSV = function() {
    var sks = this.space.content.skeletons,
        rows = ["neuron, skeleton_id, treenode_id, parent_treenode_id, x, y, z, r"];
    Object.keys(sks).forEach(function(skid) {
      var sk = sks[skid];
      if (!sk.visible) return;
      var vs = sk.getPositions(),
          arbor = sk.createArbor(),
          edges = arbor.edges,
          name = CATMAID.NeuronNameService.getInstance().getName(skid);
      edges[arbor.root] = ''; // rather than null
      Object.keys(vs).forEach(function(tnid) {
        var v = vs[tnid];
        var mesh = sk.radiusVolumes[tnid];
        var r = mesh ? mesh.scale.x : 0; // See createNodeSphere and createCylinder
        rows.push('"' + name + '", ' + skid + "," + tnid + "," + edges[tnid]  + "," + v.x + "," + v.y + "," + v.z + "," + r);
      });
    });
    saveAs(new Blob([rows.join('\n')], {type : 'text/csv'}), "skeleton_coordinates.csv");
  };

  /** Will export only those present in the 3D View, as determined by the connector restriction option.
   * By its generic nature, it will export even connectors whose relations to the skeleton are something
   * other than pre- or postsynaptic_to. */
  WebGLApplication.prototype.exportConnectorsAsCSV = function() {
    var sks = this.space.content.skeletons,
        rows = ["connector_id, skeleton_id, treenode_id, relation_id"];
    Object.keys(sks).forEach(function(skid) {
      var sk = sks[skid];
      sk.synapticTypes.forEach(function(type) {
        var vs = (sk.connectoractor ? sk.connectorgeometry : sk.geometry)[type].vertices;
        for (var i=0; i<vs.length; i+=2) {
          rows.push([vs[i].node_id, skid, vs[i+1].node_id, type].join(','));
        }
      });
    });
    saveAs(new Blob([rows.join('\n')], {type : 'text/csv'}), "connectors.csv");
  };

  WebGLApplication.prototype.exportSynapsesAsCSV = function() {
    var rows = [["pre_skeleton_id", "pre_treenode_id", "post_skeleton_id", "post_treenode_id"].join(',')];
    var unique = {};
    fetchSkeletons(
        this.getSelectedSkeletons(),
        function(skid) {
          return django_url + project.id + '/' + skid + '/0/1/0/compact-arbor';
        },
        function(skid) { return {}; }, // POST
        function(skid, json) {
          unique[skid] = true;
          json[1].forEach(function(row) {
            if (0 === row[6]) {
              // skid  is pre
              rows.push([skid, row[0], row[5], row[4]].join(','));
            } else {
              // skid is post
              rows.push([row[5], row[4], skid, row[0]].join(','));
            }
            unique[row[5]] = true;
          });
        },
        function(skid) { CATMAID.msg("Error", "Failed to load synapses for: " + skid); },
        (function() {
          saveAs(new Blob([rows.join('\n')], {type : 'text/csv'}), "synapses.csv");

          var nns = CATMAID.NeuronNameService.getInstance(),
              dummy = new THREE.Color(1, 1, 1);
          nns.registerAll(
              this,
              Object.keys(unique).reduce(function(o, skid) { o[skid] = new CATMAID.SkeletonModel(skid, "", dummy); return o; }, {}),
              function() {
                var names = Object.keys(unique).map(function(skid) {
                  return [skid, '"' +  nns.getName(skid) +'"'];
                });
                saveAs(new Blob([names.join('\n')], {type: 'text/csv'}), "neuron_name_vs_skeleton_id.csv");
              });
        }).bind(this));
  };

  /** Return a list of skeleton IDs that have nodes within radius of the active node. */
  WebGLApplication.prototype.spatialSelect = function() {
    if (!this.options.show_active_node) return alert("Enable active node!");
    var active_skid = SkeletonAnnotations.getActiveSkeletonId(),
        skeletons = this.space.content.skeletons;
    if (!active_skid) return alert("No active skeleton!");
    if (!skeletons[active_skid]) return alert("Active skeleton is not present in the 3D view!");
    var od = new CATMAID.OptionsDialog("Spatial select"),
        choice = od.appendChoice("Select neurons ", "spatial-mode",
            ["in nearby space",
             "synapting with active neuron",
             "synapting and downstream of active node",
             "synapting and upstream of active node"],
             [0, 1, 2, 3], 1),
        field = od.appendField("... within distance from the active node (nm):", "spatial-distance", this.options.distance_to_active_node),
        choice2 = od.appendChoice("If synapting, pick ", "spatial-synapse-type",
            ["both",
             "downstream partner",
             "upstream partner"],
            [-1, 0, 1], -1),
        choice3 = od.appendChoice("... of which load: ", "spatial-filter",
            ["skeletons with more than 1 node",
             "skeletons with 1 single node",
             "all"],
            [0, 1, 2], 0),
        checkbox = od.appendCheckbox("Only among loaded in 3D view", "spatial-loaded", false);

    od.onOK = (function() {
      var distance = this._validate(field.value, "Invalid distance value");
      if (!distance) return;
      var mode = Number(choice.value),
          distanceSq = distance * distance,
          synapse_mode = Number(choice2.value),
          skeleton_mode = Number(choice3.value),
          loaded_only = checkbox.checked,
          active_node = SkeletonAnnotations.getActiveNodeId(),
          p = SkeletonAnnotations.getActiveNodePositionW(),
          va = new THREE.Vector3(p.x, p.y, p.z),
          synapticTypes = WebGLApplication.prototype.Space.prototype.Skeleton.prototype.synapticTypes,
          near = null,
          query = null,
          post = null,
          filter = function(sk) {
            if (2 == skeleton_mode) return true;
            else if (0 === skeleton_mode) return sk.geometry['neurite'].vertices.length > 1;
            else if (1 == skeleton_mode) return 1 === sk.geometry['neurite'].vertices.length;
          };
      // Restrict by synaptic relation
      switch (synapse_mode) {
        case 0: synapticTypes = synapticTypes.slice(0, 1); break;
        case 1: synapticTypes = synapticTypes.slice(1, 2); break;
      }

      var newSelection = function(skids) {
        if (0 === skids.length) return CATMAID.info("No skeletons found");
        var models = {};
        skids.forEach(function(skid) {
          models[skid] = new CATMAID.SkeletonModel(skid, "", new THREE.Color().setRGB(0.5, 0.5, 0.5));
        });
        WindowMaker.create('neuron-staging-area');
        var sel = CATMAID.SelectionTable.prototype.getLastInstance();
        sel.append(models);
      };

      // Restrict by spatial position
      if (0 === mode) {
        // Intersect 3D viewer's skeletons
        if (loaded_only) {
          near = [];
          Object.keys(skeletons).forEach(function(skid) {
            if (active_skid == skid) return; // == to enable string vs int comparison
            var s = skeletons[skid];
            if (s.visible && filter(s) && s.geometry['neurite'].vertices.some(function(v) {
              return va.distanceToSquared(v) < distanceSq;
            })) {
              near.push(skid);
            }
          });
        } else {
          query = "within-spatial-distance";
          post = {distance: distance,
                  treenode_id: active_node,
                  size_mode: skeleton_mode};
        }
      } else {
        var sk = skeletons[active_skid],
            arbor = sk.createArbor();
        // Restrict part of the arbor to look at
        switch(mode) {
          case 2: // Only downstream
            arbor = arbor.subArbor(active_node);
            break;
          case 3: // Only upstream
            arbor.subArbor(active_node).nodesArray().forEach(function(node) {
              if (node === active_node) return;
              delete arbor.edges[node];
            });
        }
        var within = arbor.findNodesWithin(active_node,
            (function(child, paren) {
              return this[child].distanceTo(this[paren]);
            }).bind(sk.getPositions()),
            distance);
        // Find connectors within the part to look at
        var connectors = {};
        synapticTypes.forEach(function(type) {
          var vs = sk.geometry[type].vertices;
          for (var i=0; i<vs.length; i+=2) {
            if (within[vs[i+1].node_id]) connectors[vs[i].node_id] = true;
          }
        });
        // Find partner skeletons
        if (loaded_only) {
          near = [];
          // Find the same connectors in other loaded skeletons
          Object.keys(skeletons).forEach(function(skid) {
            if (skid === active_skid) return;
            var partner = skeletons[skid];
            if (!filter(partner)) return;
            synapticTypes.forEach(function(type) {
              var vs = partner.geometry[type].vertices;
              for (var i=0; i<vs.length; i+=2) {
                var connector_id = vs[i].node_id;
                if (connectors[connector_id]) {
                  near.push(skid);
                  break;
                }
              }
            });
          });
        } else {
          var cs = Object.keys(connectors).map(Number);
          if (cs.length > 0) {
            query = "partners-by-connector";
            post = {connectors: cs,
                    skid: active_skid,
                    relation: synapse_mode,
                    size_mode: skeleton_mode};
          } else {
            newSelection([]);
          }
        }
      }
      // List selected skeletons if any
      if (near) {
        newSelection(near);
      } else if (query) {
        requestQueue.register(django_url + project.id + '/skeletons/' + query, "POST", post,
          function(status, text) {
            if (200 !== status) return;
            var json = JSON.parse(text);
            if (json.error) return new CATMAID.ErrorDialog(
                "Could not fetch skeletons.", json.error);
            if (json.skeletons) {
              if (json.reached_limit) CATMAID.warn("Too many: loaded only a subset");
              newSelection(json.skeletons);
            } else {
              newSelection(json);
            }
          });
      }
    }).bind(this);

    od.show("auto", "auto", false);
  };



  WebGLApplication.prototype.Options = function() {
    this.debug = true;
    this.show_meshes = false;
    this.meshes_color = "#ffffff";
    this.meshes_opacity = 0.2;
    this.meshes_faces = false;
    this.show_missing_sections = false;
    this.missing_section_height = 20;
    this.show_active_node = true;
    this.active_node_on_top = false;
    this.show_floor = true;
    this.show_background = true;
    this.show_box = true;
    this.show_zplane = false;
    this.zplane_texture = true;
    this.zplane_zoomlevel = "max";
    this.zplane_opacity = 0.8;
    this.custom_tag_spheres_regex = '';
    this.neuron_material = 'lambert';
    this.connector_filter = false;
    this.shading_method = 'none';
    this.color_method = 'none';
    this.tag_regex = '';
    this.connector_color = 'cyan-red';
    this.camera_view = 'perspective';
    this.lean_mode = false;
    this.synapse_clustering_bandwidth = 5000;
    this.smooth_skeletons = false;
    this.smooth_skeletons_sigma = 200; // nm
    this.resample_skeletons = false;
    this.resampling_delta = 3000; // nm
    this.skeleton_line_width = 3;
    this.skeleton_node_scaling = 1.0;
    this.invert_shading = false;
    this.follow_active = false;
    this.distance_to_active_node = 5000; // nm
    this.min_synapse_free_cable = 5000; // nm
    this.lock_view = false;
    this.animation_rotation_axis = "up";
    this.animation_rotation_speed = 0.01;
    this.animation_back_forth = false;
    this.animation_stepwise_visibility_type = 'all';
    this.animation_stepwise_visibility_options = null;
    this.strahler_cut = 2; // to approximate twigs
  };

  WebGLApplication.prototype.Options.prototype = {};

  WebGLApplication.prototype.Options.prototype.clone = function() {
    var src = this;
    return Object.keys(this).reduce(
        function(copy, key) { copy[key] = src[key]; return copy; },
        new WebGLApplication.prototype.Options());
  };

  WebGLApplication.prototype.Options.prototype.createMeshMaterial = function(color, opacity) {
    color = color || new THREE.Color(this.meshes_color);
    if (typeof opacity === 'undefined') opacity = this.meshes_opacity;
    return new THREE.MeshLambertMaterial({color: color, opacity: opacity,
      transparent: opacity !== 1, wireframe: !this.meshes_faces, side: THREE.DoubleSide,
      depthWrite: opacity === 1});
  };


  /** Persistent options, get replaced every time the 'ok' button is pushed in the dialog. */
  WebGLApplication.prototype.OPTIONS = new WebGLApplication.prototype.Options();

  /** Receives an extra argument (an event) which is ignored. */
  WebGLApplication.prototype.updateColorMethod = function(colorMenu) {
    if ('downstream-of-tag' === colorMenu.value) {
      var dialog = new CATMAID.OptionsDialog("Type in tag");
      dialog.appendMessage("Nodes downstream of tag: magenta.\nNodes upstream of tag: dark grey.");
      var input = dialog.appendField("Tag (regex): ", "tag_text", this.options.tag_regex);
      dialog.onOK = (function() {
        this.options.tag_regex = input.value;
        this.options.color_method = colorMenu.value;
        this.updateSkeletonColors();
      }).bind(this);
      dialog.onCancel = function() {
        // Reset to default (can't know easily what was selected before).
        colorMenu.selectedIndex = 0;
      };
      dialog.show();
      return;
    }

    this.options.color_method = colorMenu.value;
    this.space.userColormap = {};
    this.updateSkeletonColors();
  };

  WebGLApplication.prototype.updateSkeletonColors = function(callback) {
    var fnRecolor = (function() {
      Object.keys(this.space.content.skeletons).forEach(function(skeleton_id) {
        this.space.content.skeletons[skeleton_id].updateSkeletonColor(this.options);
      }, this);
      if (typeof callback === "function") {
        try { callback(); } catch (e) { alert(e); }
      }
      this.space.render();
    }).bind(this);

    if (-1 !== this.options.color_method.indexOf('reviewed')) {
      var skeletons = this.space.content.skeletons;
      // Find the subset of skeletons that don't have their reviews loaded
      var skeleton_ids = Object.keys(skeletons).filter(function(skid) {
        return !skeletons[skid].reviews;
      });
      // Will invoke fnRecolor even if the list of skeleton_ids is empty
      fetchSkeletons(
          skeleton_ids,
          function(skeleton_id) {
            return django_url + project.id + '/skeleton/' + skeleton_id + '/reviewed-nodes';
          },
          function(skeleton_id) { return {}; }, // post
          function(skeleton_id, json) {
            skeletons[skeleton_id].reviews = json;
          },
          function(skeleton_id) {
            // Failed loading
            skeletons[skeleton_id].reviews = {}; // dummy
            console.log('ERROR: failed to load reviews for skeleton ' + skeleton_id);
          },
          fnRecolor);
    } else if ('axon-and-dendrite' === this.options.color_method
            || 'dendritic-backbone' === this.options.shading_method) {
      var skeletons = this.space.content.skeletons;
      // Find the subset of skeletons that don't have their axon loaded
      var skeleton_ids = Object.keys(skeletons).filter(function(skid) {
        return !skeletons[skid].axon;
      });
      fetchSkeletons(
          skeleton_ids,
          function(skid) {
            return django_url + project.id + '/' + skid + '/0/1/0/compact-arbor';
          },
          function(skid) { return {}; }, // post
          function(skid, json) {
            skeletons[skid].axon = skeletons[skid].splitByFlowCentrality(json);
          },
          function(skid) {
            // Failed loading
            skeletons[skid].axon = null;
            console.log('ERROR: failed to load axon-and-dendrite for skeleton ' + skid);
          },
          fnRecolor);
    } else {
      fnRecolor();
    }
  };

  WebGLApplication.prototype.XYView = function() {
    this.space.view.XY();
    this.space.render();
  };

  WebGLApplication.prototype.XZView = function() {
    this.space.view.XZ();
    this.space.render();
  };

  WebGLApplication.prototype.ZYView = function() {
    this.space.view.ZY();
    this.space.render();
  };

  WebGLApplication.prototype.ZXView = function() {
    this.space.view.ZX();
    this.space.render();
  };

  /**
   * Store the curren view with the given name.
   */
  WebGLApplication.prototype.storeCurrentView = function(name, callback) {
    if (!name) {
      var dialog = new CATMAID.OptionsDialog("Store current view");
      dialog.appendMessage('Please enter a name for the current view');
      var n = this.getStoredViews().length + 1;
      var nameField = dialog.appendField("Name: ", "new-view-name", 'View ' + n);

      // Call this function with a name as parameter
      dialog.onOK = (function() {
        this.storeCurrentView(nameField.value, callback);
      }).bind(this);
      dialog.show(300, 200, true);
    } else {
      // Abort if a view with this name exists already
      if (name in this.availableViews) {
        CATMAID.error("A view with the name \"" + name + "\" already exists.");
        return;
      }
      // Store view
      this.availableViews[name] = this.space.view.getView();

      if (callback) {
        callback();
      }
    }
  };

  /**
   * Return the list of stored views.
   */
  WebGLApplication.prototype.getStoredViews = function() {
    return Object.keys(this.availableViews);
  };

  /**
   * Set the view to a previously stored one and return true. Returns false if
   * no views was found under the given name.
   *
   * @param {String} name - name of the view to activate
   */
  WebGLApplication.prototype.activateView = function(name) {
    if (!(name in this.availableViews)) {
      CATMAID.error("There is no view named \"" + name + "\"!");
      return;
    }
    // Activate view by executing the stored function
    var view = this.availableViews[name];
    this.space.view.setView(view.target, view.position, view.up, view.zoom,
        view.orthographic);
    // Update options
    this.options.camera_view = view.orthographic ? 'orthographic' : 'perspective';
    // Render scene
    this.space.render();
  };

  WebGLApplication.prototype._skeletonVizFn = function(field) {
    return function(skeleton_id, value) {
      var skeletons = this.space.content.skeletons;
      if (!skeletons.hasOwnProperty(skeleton_id)) return;
      skeletons[skeleton_id]['set' + field + 'Visibility'](value);
      this.space.render();
    };
  };

  WebGLApplication.prototype.setSkeletonPreVisibility = WebGLApplication.prototype._skeletonVizFn('Pre');
  WebGLApplication.prototype.setSkeletonPostVisibility = WebGLApplication.prototype._skeletonVizFn('Post');
  WebGLApplication.prototype.setSkeletonTextVisibility = WebGLApplication.prototype._skeletonVizFn('Text');

  /**
   * Allow only connectors that have more than one partner in the current
   * selection
   */
  WebGLApplication.filterSharedConnectors = function(counts) {
    var common = {};
    for (var connector_id in counts) {
      if (counts.hasOwnProperty(connector_id) && counts[connector_id].length > 1) {
        common[connector_id] = null; // null, just to add something
      }
    }
    return common;
  };

  /**
   * Allow only connectors that have more than one partner in the current
   * selection
   */
  WebGLApplication.filterPrePostConnectors = function(counts) {
    var common = {};
    for (var connector_id in counts) {
      if (counts.hasOwnProperty(connector_id) &&
          counts[connector_id].some(isPresynaptic) &&
          counts[connector_id].some(isPostsynaptic)) {
        common[connector_id] = null; // null, just to add something
      }
    }
    return common;

    function isPresynaptic(value) { return 'presynaptic_to' === value[1]; }
    function isPostsynaptic(value) { return 'postsynaptic_to' === value[1]; }
  };

  /**
   * Allow only connectors that have more than one partner in the current
   * selection and that connect skeletons between the two groups.
   */
  WebGLApplication.filterGroupSharedConnectors = function(group1, group2, onlyPrePost, counts) {
    // Find all shared connecors
    var common = {};
    for (var connector_id in counts) {
      if (counts.hasOwnProperty(connector_id)) {
        // Only allow connectors that connect to both source groups, find links to
        // each group from the current connector.
        var inSource1 = [], inSource2 = [];
        for (var i=0; i<counts[connector_id].length; ++i) {
          var link = counts[connector_id][i];
          if (group1.hasOwnProperty(link[0])) inSource1.push(link);
          if (group2.hasOwnProperty(link[0])) inSource2.push(link);
        }

        // For being visible, the connector has to have links into both groups
        var visible = inSource1.length > 0 && inSource2.length > 0;
        // If at least one pre-post-connection between the two groups is required,
        // check for this.
        if (visible && (onlyPrePost[0] || onlyPrePost[1])) {
          var preIn1 = inSource1.some(isPresynaptic);
          var preIn2 = inSource2.some(isPresynaptic);
          var postIn1 = inSource1.some(isPostsynaptic);
          var postIn2 = inSource2.some(isPostsynaptic);
          visible = (onlyPrePost[0] && preIn1 && postIn2) ||
                    (onlyPrePost[1] && preIn2 && postIn1);
        }

        if (visible) {
          common[connector_id] = null; // null, just to add something
        }
      }
    }

    return common;

    function isPresynaptic(value) { return 'presynaptic_to' === value[1]; }
    function isPostsynaptic(value) { return 'postsynaptic_to' === value[1]; }
  };

  /**
   * Get user input for creating a goup share filter for connectors. It requires
   * two skeleton sources that form the groups between which connectors are
   * allowed.
   */
  WebGLApplication.makeGroupShareConnectorFilter = function(callback) {
    var source1, source2;

    // Add skeleton source message and controls
    var dialog = new CATMAID.OptionsDialog('Select groups');

    // Add user interface
    dialog.appendMessage('Please select two skeleton sources that represent ' +
        'groups. Only connections between neurons visible in the 3D viewer ' +
        'that link neurons from one group to the other will be shown.');
    var source1Input = addSourceInput(dialog.dialog, "Source 1:");
    var source2Input = addSourceInput(dialog.dialog, "Source 2:");
    var source1PrePost = dialog.appendCheckbox(
        "Restrict to pre->post from source 1 to source 2");
    var source2PrePost = dialog.appendCheckbox(
        "Restrict to pre->post from source 2 to source 1");

    // Add handler for initiating the export
    dialog.onOK = function() {
      var source1 = CATMAID.skeletonListSources.getSource($(source1Input).val());
      var source2 = CATMAID.skeletonListSources.getSource($(source2Input).val());
      if (!source1 || !source2) {
        CATMAID.error("Couldn't find expected skeleton sources");
        return;
      }
      var group1 = source1.getSelectedSkeletonModels();
      var group2 = source2.getSelectedSkeletonModels();
      if (!group1 || !group2) {
        CATMAID.error("Couldn't find expected skeleton models");
        return;
      }

      var filter =  WebGLApplication.filterGroupSharedConnectors.bind(
          this, group1, group2,
          [source1PrePost.checked, source2PrePost.checked]);

      if (CATMAID.tools.isFn(callback)) {
        callback(filter);
      }
    };

    dialog.onCancel = function() {
      if (CATMAID.tools.isFn(callback)) {
        callback(null);
      }
    };

    dialog.show(350, 320, true);

    function addSourceInput(d, name) {
      var select = document.createElement('select');
      CATMAID.skeletonListSources.createOptions().forEach(function(option, i) {
        select.options.add(option);
        if (option.value === 'Active skeleton') select.selectedIndex = i;
      });
      var label_p = document.createElement('p');
      var label = document.createElement('label');
      label.appendChild(document.createTextNode(name));
      label.appendChild(select);
      label_p.appendChild(label);
      d.appendChild(label_p);
      return select;
    }
  };

  WebGLApplication.prototype.setConnectorRestriction = function(restriction) {
    var self = this;

    if ('none' === restriction) {
      this.options.connector_filter = false;
    } else if ('all-shared' === restriction) {
      this.options.connector_filter = WebGLApplication.filterSharedConnectors;
    } else if ('all-pre-post' === restriction) {
      this.options.connector_filter = WebGLApplication.filterPrePostConnectors;
    } else if ('all-group-shared' === restriction) {
      WebGLApplication.makeGroupShareConnectorFilter(function(filter) {
        if (filter) {
          self.options.connector_filter = filter;
          self.refreshRestrictedConnectors();
        }
      });
      // Prevent application of filter. This is done in function above, once user
      // input is complete.
      return;
    } else {
      throw new CATMAID.ValueError('Unknown connector restriction: ' + restriction);
    }

    this.refreshRestrictedConnectors();
  };

  WebGLApplication.prototype.refreshRestrictedConnectors = function() {
    // Display regular markers only if no restriction is used
    var skeletons = this.space.content.skeletons;
    var skids = Object.keys(skeletons);
    var regularMarkerVisible = this.options.connector_filter ? false : true;
    skids.forEach(function(skid) {
      skeletons[skid].setPreVisibility(regularMarkerVisible);
      skeletons[skid].setPostVisibility(regularMarkerVisible);
      $('#skeletonpre-'  + skid).attr('checked', regularMarkerVisible);
      $('#skeletonpost-' + skid).attr('checked', regularMarkerVisible);
    });

    if (this.options.connector_filter) {
      var restriction = this.options.connector_filter;

      // Find all connector IDs referred to by more than one skeleton
      // but only for visible skeletons
      var visible_skeletons = Object.keys(skeletons).filter(function(skeleton_id) {
        return skeletons[skeleton_id].visible;
      });
      var synapticTypes = this.space.Skeleton.prototype.synapticTypes;

      // Map all connectors to the skeletons they connect to
      var counts = visible_skeletons.reduce(function(counts, skeleton_id) {
        return synapticTypes.reduce(function(counts, type) {
          var vertices = skeletons[skeleton_id].geometry[type].vertices;
          // Vertices is an array of Vector3, every two a pair, the first at the
          // connector and the second at the node
          for (var i=vertices.length-2; i>-1; i-=2) {
            var connector_id = vertices[i].node_id;
            if (!counts.hasOwnProperty(connector_id)) {
              counts[connector_id] = [];
            }
            // Store a reference to the type for each connector
            counts[connector_id].push([skeleton_id, type]);
          }
          return counts;
        }, counts);
      }, {});

      // Filter all connectors
      var common = restriction(counts);

      var visible_set = visible_skeletons.reduce(function(o, skeleton_id) {
        o[skeleton_id] = null;
        return o;
      }, {});

      // Remember current set of filtered connectors
      this.filteredConnectors = {
        'connectorIds': Object.keys(common),
        'skeletonIds': visible_skeletons
      };

      for (var skeleton_id in skeletons) {
        if (skeletons.hasOwnProperty(skeleton_id)) {
          skeletons[skeleton_id].remove_connector_selection();
          if (skeleton_id in visible_set) {
            skeletons[skeleton_id].create_connector_selection( common );
          }
        }
      }
    } else {
      skids.forEach(function(skid) {
        skeletons[skid].remove_connector_selection();
      });
      // Declare that there is no filter used at the moment
      this.filteredConnectors = null;
    }

    this.space.render();
  };

  /**
   * Set neuron visibility with the help of a dialog in case the visibility type
   * needs
   */
  WebGLApplication.prototype.setAnimationNeuronVisibility = function(type, options) {
    var visibility = CATMAID.WebGLApplication.AnimationNeuronVisibilities[type];
    if (!visibility) {
      throw new CATMAID.ValueError("Unknown neuron visibility type: " + type);
    }

    // Bind visibility to widget and option object
    this.options.animation_stepwise_visibility_type = type;
    this.options.animation_stepwise_visibility_options = options;
  };

  WebGLApplication.AnimationNeuronVisibilities = {
    'all': function() {},
    'n-per-rotation': function(options, skeletonIds, visibleSkeletons, r) {
      // Expect r to be the numnber of rotations done
      var skeletonIndex = parseInt(r * options.n);
      // Make next skeleton visible, if available
      for (var i=0; i<options.n; ++i) {
        if ((skeletonIndex + i) < skeletonIds.length) {
          visibleSkeletons.push(skeletonIds[skeletonIndex + i]);
        }
      }
    },
    'explicit-order': function(options, skeletonIds, visibleSkeletons, r) {
      if (r in options.rotations) {
        options.rotations[r].forEach(function(skeletonId) {
          visibleSkeletons.push(skeletonId);
        });
      }
    }
  };

  WebGLApplication.prototype.set_shading_method = function() {
    // Set the shading of all skeletons based on the state of the "Shading" pop-up menu.
    this.options.shading_method = $('#skeletons_shading' + this.widgetID + ' :selected').attr("value");

    this.updateSkeletonColors();
  };

  WebGLApplication.prototype.look_at_active_node = function() {
    this.space.content.active_node.updatePosition(this.space, this.options);
    this.space.view.controls.target.copy(this.space.content.active_node.mesh.position);
    this.space.render();
  };

  WebGLApplication.prototype.updateActiveNodePosition = function() {
    this.space.content.active_node.updatePosition(this.space, this.options);
    if (this.space.content.active_node.mesh.visible) {
      this.space.render();
    }
  };

  WebGLApplication.prototype.handleRadiusChange = function(updatedNodes) {
    if (updatedNodes) {
      var updatedSkeletonIds = [];
      // Collect changed skeletons
      for (var nodeId in updatedNodes) {
        var skid = updatedNodes[nodeId].skeleton_id;
        if (skid && -1 == updatedSkeletonIds.indexOf(skid)) {
          updatedSkeletonIds.push(skid);
        }
      }
      // Update if we display a changed skeleton
      this.reloadSkeletons(updatedSkeletonIds);
    }
  };

  WebGLApplication.prototype.staticUpdateActiveNodePosition = function() {
    this.getInstances().map(function(instance) {
      instance.updateActiveNodePosition();
      // Center the active node, if wanted
      if (instance.options.follow_active) {
        instance.look_at_active_node();
      }
    });
  };

  WebGLApplication.prototype.has_skeleton = function(skeleton_id) {
    return this.space.content.skeletons.hasOwnProperty(skeleton_id);
  };

  /** Reload only if present. */
  WebGLApplication.prototype.staticReloadSkeletons = function(skeleton_ids) {
    this.getInstances().forEach(function(instance) {
      instance.reloadSkeletons(skeleton_ids);
    });
  };

  /** Fetch skeletons one by one, and render just once at the end. */
  WebGLApplication.prototype.addSkeletons = function(models, callback) {
    // Update skeleton properties for existing skeletons, and remove them from models
    var skeleton_ids = Object.keys(models).filter(function(skid) {
      if (skid in this.space.content.skeletons) {
        var model = models[skid],
            skeleton = this.space.content.skeletons[skid];
        skeleton.skeletonmodel = model;
        skeleton.setActorVisibility(model.selected);
        skeleton.setPreVisibility(model.pre_visible);
        skeleton.setPostVisibility(model.post_visible);
        skeleton.setTextVisibility(model.text_visible);
        skeleton.setMetaVisibility(model.meta_visible);
        skeleton.actorColor = model.color.clone();
        skeleton.opacity = model.opacity;
        skeleton.updateSkeletonColor(this.options);
        // In case connectors are colored like skeletons, they have yo be
        // updated, too.
        if ('skeleton' === this.options.connector_color) {
          this.space.updateConnectorColors(this.options, [skeleton]);
        }
        return false;
      }
      return true;
    }, this);

    if (0 === skeleton_ids.length) return;

    var options = this.options;
    var url1 = django_url + project.id + '/',
        lean = options.lean_mode ? 0 : 1,
        url2 = '/' + lean  + '/' + lean + '/compact-skeleton';


    // Register with the neuron name service and fetch the skeleton data
    CATMAID.NeuronNameService.getInstance().registerAll(this, models,
      fetchSkeletons.bind(this,
          skeleton_ids,
          function(skeleton_id) {
            return url1 + skeleton_id + url2;
          },
          function(skeleton_id) {
            return {}; // the post
          },
          (function(skeleton_id, json) {
            var sk = this.space.updateSkeleton(models[skeleton_id], json, options);
            if (sk) sk.show(this.options);
          }).bind(this),
          function(skeleton_id) {
            // Failed loading: will be handled elsewhere via fnMissing in fetchCompactSkeletons
          },
          (function() {
            this.updateSkeletonColors(
              (function() {
                  if (this.options.connector_filter) this.refreshRestrictedConnectors();
                  if (typeof callback === "function") {
                    try { callback(); } catch (e) { alert(e); }
                  }
              }).bind(this));
          }).bind(this)));
  };

  /** Reload skeletons from database. */
  WebGLApplication.prototype.updateSkeletons = function() {
    var models = this.getSelectedSkeletonModels(); // visible ones
    this.clear();
    this.append(models);
  };

  WebGLApplication.prototype.updateActiveSkeleton = function() {
    var skid = SkeletonAnnotations.getActiveSkeletonId();
    if (undefined === skid) return CATMAID.info("No active skeleton");
    var sk = this.space.content.skeletons[skid];
    if (!sk) return CATMAID.info("Active skeleton is not present in the 3D viewer");
    // Remove and re-add (without removing, only properties are updated upon append, not the geometry)
    this.space.removeSkeleton(sk.id);
    var models = {};
    models[sk.id] = sk.skeletonmodel;
    this.append(models);
  };

  WebGLApplication.prototype.append = function(models) {
    if (0 === Object.keys(models).length) {
      CATMAID.info("No skeletons selected!");
      return;
    }
    this.addSkeletons(models, false);
    if (this.options.connector_filter) {
      this.refreshRestrictedConnectors();
    } else {
      this.space.render();
    }
  };

  WebGLApplication.prototype.clear = function() {
    this.removeSkeletons(Object.keys(this.space.content.skeletons));
    this.space.render();
  };

  WebGLApplication.prototype.getSkeletonColor = function( skeleton_id ) {
    if (skeleton_id in this.space.content.skeletons) {
      return this.space.content.skeletons[skeleton_id].actorColor.clone();
    }
    return new THREE.Color().setRGB(1, 0, 1);
  };

  WebGLApplication.prototype.hasSkeleton = function(skeleton_id) {
    return skeleton_id in this.space.content.skeletons;
  };

  /**
   * Remove and re-add all skeletons from the passed in list of IDs that are
   * currently loaded.
   */
  WebGLApplication.prototype.reloadSkeletons = function(skeleton_ids) {
    var models = skeleton_ids.filter(this.hasSkeleton, this)
        .reduce((function(m, skid) {
           m[skid] = this.getSkeletonModel(skid);
           return m;
        }).bind(this), {});
    this.space.removeSkeletons(skeleton_ids);
    this.updateModels(models);
  };

  WebGLApplication.prototype.removeSkeletons = function(skeleton_ids) {
    if (!this.space) return;
    this.space.removeSkeletons(skeleton_ids);
    if (this.options.connector_filter) this.refreshRestrictedConnectors();
    else this.space.render();
  };

  WebGLApplication.prototype.changeSkeletonColors = function(skeleton_ids, colors) {
    var skeletons = this.space.content.skeletons;

    skeleton_ids.forEach(function(skeleton_id, index) {
      if (!skeletons.hasOwnProperty(skeleton_id)) {
        console.log("Skeleton "+skeleton_id+" does not exist.");
      }
      if (undefined === colors) skeletons[skeleton_id].updateSkeletonColor(this.options);
      else skeletons[skeleton_id].changeColor(colors[index], this.options);
    }, this);

    this.space.render();
    return true;
  };

  // TODO obsolete code from segmentationtool.js
  WebGLApplication.prototype.addActiveObjectToStagingArea = function() {
    alert("The function 'addActiveObjectToStagingArea' is no longer in use.");
  };

  WebGLApplication.prototype.showActiveNode = function() {
    this.space.content.active_node.setVisible(true);
  };

  /**
   * Display meshes in the passed-in object. Mesh IDs should be mapped to an
   * array following this format: [[points], [[faces]].
   *
   * @returns a function that removes the added meshes when called
   */
  WebGLApplication.prototype.showTriangleMeshes = function(meshes) {
    var addedObjects = [];
    var self = this;

    var renderedMeshes = Object.keys(meshes).filter(function(name) {
      var mesh = meshes[name];
      var points = mesh[0];
      var hull = mesh[1];
      if (!points || 0 === points.length || !hull || 0 === hull.length) {
        return false;
      }
      // Make the mesh with the faces specified in the hull array
      var geom = new THREE.Geometry();
      points.forEach(function(p) {
        this.vertices.push(new THREE.Vector3(p[0], p[1], p[2]));
      }, geom);
      hull.forEach(function(indices) {
        this.faces.push(new THREE.Face3(indices[0], indices[1], indices[2]));
      }, geom);
      geom.computeFaceNormals();

      // Create mesh based on volume color and opacity selected in 3D viewer.
      // Ignore the face setting for now to always show faces.
      var opacity = self.options.meshes_opacity;
      var mesh = new THREE.Mesh(
          geom,
          new THREE.MeshLambertMaterial(
             {color: self.options.meshes_color,
              opacity: opacity,
              transparent: opacity !== 1.0,
              wireframe: false,
              depthWrite: opacity === 1.0,
              side: THREE.DoubleSide}));

      var wfh = new THREE.WireframeHelper(mesh, 0x000000);
      wfh.material.linewidth = 2;
      self.space.add(mesh);
      self.space.add(wfh);
      this.push(mesh);
      this.push(wfh);
      return true;
    }, addedObjects);

    if (0 < renderedMeshes.length) {
      this.space.render();
    }

    return function() {
      if (!self || !self.space) {
        // No need to remove anything if 3D viewer or its space are gone
        return;
      }
      addedObjects.forEach(function(o) {
          this.remove(o);
      }, self.space);
      self.space.render();
    };
  };

  /**
   * Converts simple X3D IndexedFaceSet and IndexedTriangleSet nodes to a VRML
   * representation.
   */
  function x3dToVrml(x3d) {
    var vrml = x3d;
    var shapePrefix = "Shape {\n  geometry IndexedFaceSet {\n     ";

    // Indexed triangle set
    vrml = vrml.replace(/<IndexedTriangleSet\s*index='([-\d\s]*)'\s*>/gi,
        function(match, indexGroup) {
          var triIndices = indexGroup.split(" ");
          var nVertices = triIndices.length;
          // Mark end of face after each three points. This wouldn't be
          // required if the Three.js loader would support triangle sets.
          var indices = new Array(nVertices + Math.floor(nVertices / 3));
          var offset = 0;
          for (var i=0; i<triIndices.length; ++i) {
            indices[i + offset] = triIndices[i];
            if (0 === (i + 1) % 3) {
              ++offset;
              indices[i + offset] = "-1";
            }
          }

          return shapePrefix + "    coordIndex [" + indices.join(", ") + "]\n";
        }).replace(/<\/IndexedTriangleSet>/gi, "  }\n}");

    // Indexed face set
    vrml = vrml.replace(/<IndexedFaceSet\s*coordIndex='([-\d\s]*)'\s*>/gi,
        function(match, indexGroup) {
          var indices = indexGroup.split(" ");
          return shapePrefix + "    coordIndex [" + indices.join(", ") + "]\n";
        }).replace(/<\/IndexedFaceSet>/gi, "  }\n}");

    // Coordinates
    vrml = vrml.replace(/<Coordinate\s*point='([-.\d\s]*)'\s*\/>/gi,
        function(match, pointGroup) {
          var points = pointGroup.split(" ");
          var groupedPoints = new Array(Math.floor(points.length / 3));
          // Store points in component groups
          for (var i=0; i<groupedPoints.length; ++i) {
            var j = 3 * i;
            groupedPoints[i] = points[j] + " " + points[j+1] + " " + points[j+2];
          }
          return "  coord Coordinate {\n    point [" + groupedPoints.join(", ") + "]\n  }";
        });

    return "#VRML V2.0 utf8\n\n" + vrml;
  }

  /**
   * Show or hide a stored volume with a given Id.
   */
  WebGLApplication.prototype.showVolume = function(volumeId, visible) {
    var existingVolume = this.loadedVolumes[volumeId];
    if (visible) {
      // Bail out if the volume in question is already visible
      if (existingVolume) {
        CATMAID.warn("Volume \"" + volumeId + "\" is already visible.");
        return;
      }

      CATMAID.Volumes.get(project.id, volumeId)
        .then((function(volume) {
          // Convert X3D mesh to simple VRML and have Three.js load it
          var vrml = x3dToVrml(volume.mesh);
          var loader = new THREE.VRMLLoader();
          var scene = loader.parse(vrml);
          if (scene.children) {
            var material = this.options.createMeshMaterial();
            var addedMeshes = scene.children.map(function(mesh) {
              mesh.material = material;
              this.space.scene.add(mesh);
              return mesh;
            }, this);
            // Store mesh reference
            this.loadedVolumes[volumeId] = addedMeshes;
            this.space.render();
          } else {
            CATMAID.warn("Couldn't parse volume \"" + volumeId + "\"");
          }
        }).bind(this))
        .catch(CATMAID.handleError);
    } else if (existingVolume) {
      // Remove volume
      existingVolume.forEach(function(v) {
        this.space.scene.remove(v);
      }, this);
      delete this.loadedVolumes[volumeId];
      this.space.render();
    }
  };

  /**
   * Return IDs of the currently loaded volumes.
   */
  WebGLApplication.prototype.getLoadedVolumeIds = function() {
    return Object.keys(this.loadedVolumes);
  };

  /** Defines the properties of the 3d space and also its static members like the bounding box and the missing sections. */
  WebGLApplication.prototype.Space = function( w, h, container, stack, options ) {
    this.stack = stack;
    this.container = container; // used by MouseControls
    this.options = options;

    this.canvasWidth = w;
    this.canvasHeight = h;

    var p = stack.createStackToProjectBox(stack.createStackExtentsBox());
    this.dimensions = {
      min: new THREE.Vector3(p.min.x, p.min.y, p.min.z),
      max: new THREE.Vector3(p.max.x, p.max.y, p.max.z)
    };
    // Absolute center in Space coordinates (not stack coordinates)
    this.center = this.createCenter();

    // Set the node scaling for skeletons so that it makes nodes not too big for
    // higher resolutions and not too small for lower ones.
    options.skeleton_node_scaling = 2 * Math.min(stack.resolution.x,
        stack.resolution.y, stack.resolution.z);
    // Make the scaling factor look a bit prettier by rounding to two decimals
    options.skeleton_node_scaling = Number(options.skeleton_node_scaling.toFixed(2));

    this.userColormap = {};

    // WebGL space
    this.scene = new THREE.Scene();
    // A render target used for picking objects
    this.pickingTexture = new THREE.WebGLRenderTarget(w, h);
    this.pickingTexture.texture.generateMipmaps = false;

    this.view = new this.View(this);
    this.lights = this.createLights(this.dimensions, this.center, this.view.camera);
    this.lights.forEach(function(l) {
      this.add(l);
    }, this.scene);

    // Content
    this.staticContent = new this.StaticContent(this.dimensions, stack, this.center, options);
    this.scene.add(this.staticContent.box);
    this.scene.add(this.staticContent.floor);

    this.content = new this.Content(options);
    this.scene.add(this.content.active_node.mesh);
  };

  WebGLApplication.prototype.Space.prototype = {};

  /**
   * Activate a separate camera which as a look on this the scene. Additionally,
   * a camera helper is activated for the main camera. This helper visualizes
   * the main camera's view frustum.
   */
  WebGLApplication.prototype.Space.prototype.setDebug = function(debug) {
    var camera;
    if (debug) {
      camera = this.view.debugCamera;
      this.cameraHelper = new THREE.CameraHelper(this.view.mainCamera);
      this.scene.add(this.cameraHelper);
    } else {
      camera = this.view.mainCamera;
      if (this.cameraHelper) {
        this.scene.remove(this.cameraHelper);
        this.cameraHelper = undefined;
      }
    }
    this.view.camera = camera;
    this.view.controls.object = camera;
  };

  WebGLApplication.prototype.Space.prototype.setSize = function(canvasWidth, canvasHeight) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.view.camera.setSize(canvasWidth, canvasHeight);
    this.view.camera.updateProjectionMatrix();
    this.pickingTexture.setSize(canvasWidth, canvasHeight);
    this.view.renderer.setSize(canvasWidth, canvasHeight);
    if (this.view.controls) {
      this.view.controls.handleResize();
    }
  };

  WebGLApplication.prototype.Space.prototype.createCenter = function() {
    return this.dimensions.min.clone().lerp(this.dimensions.max, 0.5);
  };


  WebGLApplication.prototype.Space.prototype.createLights = function(dimensions, center, camera) {
    var ambientLight = new THREE.AmbientLight(0x505050);
    var height = dimensions.max.y - dimensions.min.y;
    var hemiLight = new THREE.HemisphereLight( 0xffffff, 0x000000, 1 );
    hemiLight.position.set( center.x, - center.y - height, center.z);
    return [ambientLight, hemiLight];
  };

  WebGLApplication.prototype.Space.prototype.add = function(mesh) {
    this.scene.add(mesh);
  };

  WebGLApplication.prototype.Space.prototype.remove = function(mesh) {
    this.scene.remove(mesh);
  };

  WebGLApplication.prototype.Space.prototype.removeAll = function(objects) {
    this.scene.remove.apply(this.scene, objects);
  };

  WebGLApplication.prototype.Space.prototype.render = function() {
    if (this.view) {
      this.view.render();
    }
  };

  WebGLApplication.prototype.Space.prototype.destroy = function() {
    // remove active_node and project-wise meshes
    this.scene.remove(this.content.active_node.mesh);
    this.content.meshes.forEach(function(m) { this.remove(m); }, this.scene);

    // dispose active_node and meshes
    this.content.dispose();

    // dispose and remove skeletons
    this.removeSkeletons(Object.keys(this.content.skeletons));

    this.lights.forEach(function(l) { this.remove(l); }, this.scene);

    // dispose meshes and materials
    this.staticContent.dispose();

    // remove meshes
    if (this.staticContent.box) this.scene.remove(this.staticContent.box);
    this.scene.remove(this.staticContent.floor);
    if (this.staticContent.zplane) this.scene.remove(this.staticContent.zplane);
    this.staticContent.missing_sections.forEach(function(m) { this.remove(m); }, this.scene);

    this.view.destroy();

    Object.keys(this).forEach(function(key) { delete this[key]; }, this);
  };

  WebGLApplication.prototype.Space.prototype.removeSkeletons = function(skeleton_ids) {
    // First remove all objects from the Three.js scene

    // Destroy all CATMAID parts of these objects
    var collection = [];
    skeleton_ids.forEach(function(skeleton_id) {
      this.removeSkeleton(skeleton_id, collection);
    }, this);
    this.removeAll(collection);
  };

  WebGLApplication.prototype.Space.prototype.removeSkeleton = function(skeleton_id, collection) {
    if (skeleton_id in this.content.skeletons) {
      this.content.skeletons[skeleton_id].destroy(collection);
      delete this.content.skeletons[skeleton_id];
    }
  };

  WebGLApplication.prototype.Space.prototype.updateSplitShading = function(old_skeleton_id, new_skeleton_id, options) {
    if ('active_node_split' === options.shading_method ||
        'near_active_node' === options.shading_method ||
        'near_active_node_z_project' === options.shading_method ||
        'near_active_node_z_camera' === options.shading_method) {
      if (old_skeleton_id !== new_skeleton_id) {
        if (old_skeleton_id && old_skeleton_id in this.content.skeletons) this.content.skeletons[old_skeleton_id].updateSkeletonColor(options);
      }
      if (new_skeleton_id && new_skeleton_id in this.content.skeletons) this.content.skeletons[new_skeleton_id].updateSkeletonColor(options);
    }
  };

  /**
   * Return an object containing visibility information on all loaded skeleton.
   */
  WebGLApplication.prototype.Space.prototype.getVisibilityMap = function()
  {
    var visibilityMap = {};
    for (var skid in this.content.skeletons) {
      var s = this.content.skeletons[skid];
      visibilityMap[skid] = {
        actor: s.visible,
        pre: s.skeletonmodel.pre_visible,
        post: s.skeletonmodel.post_visible,
        text: s.skeletonmodel.text_visible,
        meta: s.skeletonmodel.meta_visible
      };
    }

    return visibilityMap;
  };

  /**
   * Updates the visibility of all skeletons. If a skeleton ID is given as a
   * second argument, only this skeleton will be set visible (if it was visible
   * before), otherwise all skeletons are set to the state in the given map.
   */
  WebGLApplication.prototype.Space.prototype.setSkeletonVisibility = function(
      visMap, visibleSkids)
  {
    for (var skid in this.content.skeletons) {
      var s = this.content.skeletons[skid];
      var visible = visibleSkids ? (-1 !== visibleSkids.indexOf(skid)) : true;
      s.setActorVisibility(visMap[skid].actor ? visible : false);
      s.setPreVisibility(visMap[skid].pre ? visible : false);
      s.setPostVisibility(visMap[skid].post ? visible : false);
      s.setTextVisibility(visMap[skid].text ? visible : false);
      s.setMetaVisibility(visMap[skid].meta ? visible : false);
    }
  };

  WebGLApplication.prototype.Space.prototype.TextGeometryCache = function(options) {
    this.geometryCache = {};

    // Load font asynchronously, text creation will wait
    var prepare, font;
    if (options.font) {
      prepare = new Promise.resolve();
      font = options.font;
    } else {
      prepare = new Promise(function(resolve, reject) {
        var loader = new THREE.FontLoader();
        var url = CATMAID.makeStaticURL('libs/three.js/fonts/helvetiker_regular.typeface.js');
        loader.load(url, function(newFont) {
          // Share font
          options.font = newFont;
          font = newFont;
          resolve();
        }, undefined, reject);
      }).catch(CATMAID.handleError);
    }

    this.getTagGeometry = function(tagString, font) {
      if (tagString in this.geometryCache) {
        var e = this.geometryCache[tagString];
        e.refs += 1;
        return e.geometry;
      }
      // Else create, store, and return a new one:
      var text3d = new THREE.TextGeometry( tagString, {
        size: 100,
        height: 20,
        curveSegments: 1,
        font: font
      });
      text3d.computeBoundingBox();
      text3d.tagString = tagString;
      this.geometryCache[tagString] = {geometry: text3d, refs: 1};
      return text3d;
    };

    this.releaseTagGeometry = function(tagString) {
      if (tagString in this.geometryCache) {
        var e = this.geometryCache[tagString];
        e.refs -= 1;
        if (0 === e.refs) {
          delete this.geometryCache[tagString].geometry;
          delete this.geometryCache[tagString];
        }
      }
    };

    this._createMesh = function(tagString, material, font) {
      var geometry = this.getTagGeometry(tagString, font);
      var text = new THREE.Mesh(geometry, material);
      // We need to flip up, because our cameras' up direction is -Y.
      text.scale.setY(-1);
      text.visible = true;
      return text;
    };

    /**
     * Create text mesh and load font if it isn't already available yet.
     */
    this.createTextMesh = function(tagString, material, onSuccess) {
      // If font isn't loaded yet, load it and try again in 100ms.
      if (font) {
        var mesh = this._createMesh(tagString, material, font);
        onSuccess(mesh);
      } else {
        prepare.then(function() {
          if (font) {
            var mesh = this._createMesh(tagString, material, font);
            onSuccess(mesh);
          } else {
            throw new CATMAID.Error("3D viewer font couldn't be loaded");
          }
        });
      }
    };

    this.destroy = function() {
      Object.keys(this.geometryCache).forEach(function(entry) {
        this[entry].geometry.dispose();
      }, this.geometryCache);
      delete this.geometryCache;
    };
  };

  /**
   * Get the constructor for the material used for skeleton meshes.
   *
   * @param {String} neuron_material Expected to be either 'flat' or 'lambert'
   *
   * @return a THREE.js constructor for a material
   */
  var getSkeletonMaterialType = function(neuron_material) {
    if ('flat' === neuron_material) {
      return THREE.MeshBasicMaterial;
    } else if ('lambert' === neuron_material) {
      return THREE.MeshLambertMaterial;
    } else {
      throw new CATMAID.ValueError("Unknown material identifier: " + neuron_material);
    }
  };

  WebGLApplication.prototype.Space.prototype.StaticContent = function(dimensions, stack, center, options) {
    // Space elements
    this.box = this.createBoundingBox(project.focusedStackViewer.primaryStack);
    this.floor = this.createFloor(center, dimensions);

    this.zplane = null;

    this.missing_sections = [];

    // Shared across skeletons
    this.labelspheregeometry = new THREE.OctahedronGeometry(32, 3);
    this.radiusSphere = new THREE.OctahedronGeometry(10, 3);
    this.icoSphere = new THREE.IcosahedronGeometry(1, 2);
    this.cylinder = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
    this.textMaterial = new THREE.MeshNormalMaterial();

    // Make sure normals are computed on tempalte geometry
    this.labelspheregeometry.computeFaceNormals();
    this.labelspheregeometry.computeVertexNormals();

    // Mesh materials for spheres on nodes tagged with 'uncertain end', 'undertain continuation' or 'TODO'
    this.updateDynamicMaterials(options, false);
    this.textGeometryCache = new WebGLApplication.prototype.Space.prototype.TextGeometryCache(options);
    this.connectorLineColors = {'presynaptic_to': new THREE.LineBasicMaterial({color: 0xff0000, opacity: 1.0, linewidth: 6}),
                                'postsynaptic_to': new THREE.LineBasicMaterial({color: 0x00f6ff, opacity: 1.0, linewidth: 6}),
                                'gapjunction_with': new THREE.LineBasicMaterial({color: 0x9f25c2, opacity: 1.0, linewidth: 6})};
  };

  WebGLApplication.prototype.Space.prototype.StaticContent.prototype = {};

  WebGLApplication.prototype.Space.prototype.StaticContent.prototype.dispose = function() {
    // dispose ornaments
    if (this.box) {
      this.box.geometry.dispose();
      this.box.material.dispose();
    }
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.missing_sections.forEach(function(s) {
      s.geometry.dispose();
      s.material.dispose(); // it is ok to call more than once
    });
    if (this.zplane) {
      this.zplane.geometry.dispose();
      // Dispose individual zplane tiles in texture mode.
      this.zplane.material.materials.forEach(function(m) {
        m.dispose();
      });
    }

    // dispose shared geometries
    [this.labelspheregeometry, this.radiusSphere, this.icoSphere, this.cylinder].forEach(function(g) {
      g.dispose();
    });
    this.textGeometryCache.destroy();

    // dispose shared materials
    this.textMaterial.dispose();
    Object.keys(this.labelColors).forEach(function (labelType) {
      this.labelColors[labelType].dispose();
    }, this);
    this.synapticColors[0].dispose();
    this.synapticColors[1].dispose();
    this.synapticColors[2].dispose();
  };

  /**
   * Update shared materials that can be updated during run-time.
   */
  WebGLApplication.prototype.Space.prototype.StaticContent.prototype.updateDynamicMaterials = function(options, copyProperties) {
    // Material constructor depends on current options
    var Material = getSkeletonMaterialType(options['neuron_material']);

    function makeMaterial(defaultOptions, sourceObj, sourceField) {
      var properties;
      if (copyProperties && sourceObj) {
        properties = {};
        var sourceMaterial = sourceObj[sourceField];
        properties['color'] = sourceMaterial.color;
        properties['opacity'] = sourceMaterial.opacity;
        properties['transparent'] = sourceMaterial.transparent;
      } else {
        properties = defaultOptions;
      }

      return new Material(properties);
    }

    this.labelColors = {uncertain: makeMaterial({color: 0xff8000, opacity:0.6, transparent: true}, this.labelColors, 'uncertain'),
                        todo:      makeMaterial({color: 0xff0000, opacity:0.6, transparent: true}, this.labelColors, 'todo'),
                        custom:    makeMaterial({color: 0xaa70ff, opacity:0.6, transparent: true}, this.labelColors, 'custom')};
    this.synapticColors = [makeMaterial({color: 0xff0000, opacity:0.6, transparent:false}, this.synapticColors, 0),
                           makeMaterial({color: 0x00f6ff, opacity:0.6, transparent:false}, this.synapticColors, 1),
                           makeMaterial({color: 0x9f25c2, opacity:0.6, transparent:false}, this.synapticColors, 2)];
    this.synapticColors.default = makeMaterial({color: 0xff9100, opacity:0.6, transparent:false}, this.synapticColors, 'default');
  };

  WebGLApplication.prototype.Space.prototype.StaticContent.prototype.createBoundingBox = function(stack) {
    var p = stack.createStackToProjectBox(stack.createStackExtentsBox());

    var geometry = new THREE.Geometry();

    geometry.vertices.push(
      new THREE.Vector3(p.min.x, p.min.y, p.min.z),
      new THREE.Vector3(p.min.x, p.max.y, p.min.z),

      new THREE.Vector3(p.min.x, p.max.y, p.min.z),
      new THREE.Vector3(p.max.x, p.max.y, p.min.z),

      new THREE.Vector3(p.max.x, p.max.y, p.min.z),
      new THREE.Vector3(p.max.x, p.min.y, p.min.z),

      new THREE.Vector3(p.max.x, p.min.y, p.min.z),
      new THREE.Vector3(p.min.x, p.min.y, p.min.z),


      new THREE.Vector3(p.min.x, p.min.y, p.max.z),
      new THREE.Vector3(p.min.x, p.max.y, p.max.z),

      new THREE.Vector3(p.min.x, p.max.y, p.max.z),
      new THREE.Vector3(p.max.x, p.max.y, p.max.z),

      new THREE.Vector3(p.max.x, p.max.y, p.max.z),
      new THREE.Vector3(p.max.x, p.min.y, p.max.z),

      new THREE.Vector3(p.max.x, p.min.y, p.max.z),
      new THREE.Vector3(p.min.x, p.min.y, p.max.z),


      new THREE.Vector3(p.min.x, p.min.y, p.min.z),
      new THREE.Vector3(p.min.x, p.min.y, p.max.z),

      new THREE.Vector3(p.min.x, p.max.y, p.min.z),
      new THREE.Vector3(p.min.x, p.max.y, p.max.z),

      new THREE.Vector3(p.max.x, p.max.y, p.min.z),
      new THREE.Vector3(p.max.x, p.max.y, p.max.z),

      new THREE.Vector3(p.max.x, p.min.y, p.min.z),
      new THREE.Vector3(p.max.x, p.min.y, p.max.z)
    );

    geometry.computeLineDistances();

    var material = new THREE.LineBasicMaterial( { color: 0xff0000 } );
    var mesh = new THREE.LineSegments( geometry, material );

    mesh.position.set(0, 0, 0);

    // The bounding box will not move and automatic matrix update can be disabled.
    // However, we have to apply the initial position change by explicitely
    // updating the matrix.
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    return mesh;
  };

  /**
   * Creates a THREE.js line object that represents a floor grid. By default, it
   * extents around the bounding box by about twice the height of it. The grid
   * cells are placed so that they are divide the bouning box floor evenly. By
   * default, there are ten cells in each dimension within the bounding box. It is
   * positioned around the center of the dimensions. These settings can be
   * overridden with the options parameter.
   */
  WebGLApplication.prototype.Space.prototype.StaticContent.prototype.createFloor = function(center, dimensions, options) {
      var o = options || {};
      var floor = o['floor'] || dimensions.max.y;

      // 10 steps in each dimension of the bounding box
      var nBaseLines = o['nBaseLines'] || 10.0;
      var xStep = dimensions.max.x / nBaseLines;
      var zStep = dimensions.max.z / nBaseLines;
      // Extend this around the bounding box
      var xExtent = o['xExtent'] || Math.ceil(2.0 * dimensions.max.y / xStep);
      var zExtent = o['zExtent'] || Math.ceil(2.0 * dimensions.max.y / zStep);
      // Offset from origin
      var xOffset = dimensions.max.x * 0.5 - center.x;
      var zOffset = dimensions.max.z * 0.5 + center.z;
      // Get min and max coordinates of grid
      var min_x = -1.0 * xExtent * xStep + xOffset,
          max_x = dimensions.max.x + (xExtent * xStep) + xOffset;
      var min_z = -1.0 * dimensions.max.z - zExtent * zStep + zOffset,
          max_z = zExtent * zStep + zOffset;

      // Create planar mesh for floor
      var xLines = nBaseLines + 2 * xExtent + 1;
      var zLines = nBaseLines + 2 * zExtent + 1;
      var width = max_x - min_x;
      var height = max_z - min_z;

      // There are two three-component positions per line
      var positions = new Float32Array((xLines * 2 + zLines * 2) * 3);

      for (var z=0; z<zLines; ++z) {
        var i = z * 6;
        positions[i    ] = 0;
        positions[i + 1] = 0;
        positions[i + 2] = z*zStep;

        positions[i + 3] = width;
        positions[i + 4] = 0;
        positions[i + 5] = z*zStep;
      }

      for (var x=0; x<xLines; ++x) {
        var i = zLines * 6 + x * 6;
        positions[i    ] = x*xStep;
        positions[i + 1] = 0;
        positions[i + 2] = 0;

        positions[i + 3] = x*xStep;
        positions[i + 4] = 0;
        positions[i + 5] = height;
      }

      var geometry = new THREE.BufferGeometry();
      geometry.addAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.computeBoundingSphere();

      var material = new THREE.LineBasicMaterial({
        color: o['color'] || 0x535353
      });
      var mesh = new THREE.LineSegments( geometry, material );

      mesh.position.set(min_x, floor, min_z);

      // The floor will not move and automatic matrix update can be disabled.
      // However, we have to apply the initial position change by explicitely
      // updating the matrix.
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();

      return mesh;
  };


  /** Adjust visibility of static content according to the persistent options. */
  WebGLApplication.prototype.Space.prototype.StaticContent.prototype.adjust = function(options, space) {
    if (0 !== this.missing_sections.length) {
      this.missing_sections.forEach(function(m) { this.remove(m); }, space.scene);
      this.missing_sections = [];
    }
    if (options.show_missing_sections) {
      this.missing_sections = this.createMissingSections(project.focusedStackViewer.primaryStack,
                                                         options.missing_section_height);
      this.missing_sections.forEach(function(m) { this.add(m); }, space.scene);
    }

    if (options.show_background) {
      space.view.renderer.setClearColor(0x000000, 1);
    } else {
      space.view.renderer.setClearColor(0xffffff, 1);
    }

    this.floor.visible = options.show_floor;

    if (this.box) {
      space.scene.remove(this.box);
      this.box.geometry.dispose();
      this.box.material.dispose();
      this.box = null;
    }
    if (options.show_box) {
      this.box = this.createBoundingBox(project.focusedStackViewer.primaryStack);
      this.box.visible = options.show_box;
      space.scene.add(this.box);
    }

    if (options.show_zplane) {
      this.createZPlane(space, project.focusedStackViewer,
          options.zplane_texture ? options.zplane_zoomlevel : null,
          options.zplane_opacity);
    } else {
      if (this.zplane) space.scene.remove(this.zplane);
      this.zplane = null;
    }
  };

  WebGLApplication.prototype.Space.prototype.StaticContent.prototype.createPlaneGeometry =
      function (stack, tileZoomLevel) {
    var stackPlane = stack.createStackExtentsBox(),
        plane = stack.createStackToProjectBox(stackPlane),
        geometry, pDepth;

    var majorDimSeq = ['min', 'max', 'min', 'max'],
        minorDimSeq = ['min', 'min', 'max', 'max'],
        planeDimSeq = minorDimSeq,
        seq, pWidth, pHeight, pTileWidth, pTileHeight;

    switch (stack.orientation) {
      case CATMAID.Stack.ORIENTATION_XY:
        pDepth = plane.max.z - plane.min.z;
        plane.min.z = plane.max.z = 0;
        seq = {x: majorDimSeq, y: minorDimSeq, z: planeDimSeq};
        pWidth = plane.max.x - plane.min.x;
        pHeight = plane.max.y - plane.min.y;
        pTileWidth = stack.tileSource.tileWidth * stack.resolution.x;
        pTileHeight = stack.tileSource.tileHeight * stack.resolution.y;
        break;
      case CATMAID.Stack.ORIENTATION_XZ:
        pDepth = plane.max.y - plane.min.y;
        plane.min.y = plane.max.y = 0;
        seq = {x: majorDimSeq, y: planeDimSeq, z: minorDimSeq};
        pWidth = plane.max.x - plane.min.x;
        pHeight = plane.max.z - plane.min.z;
        pTileWidth = stack.tileSource.tileWidth * stack.resolution.x;
        pTileHeight = stack.tileSource.tileHeight * stack.resolution.z;
        break;
      case CATMAID.Stack.ORIENTATION_ZY:
        pDepth = plane.max.x - plane.min.x;
        plane.min.x = plane.max.x = 0;
        seq = {x: planeDimSeq, y: minorDimSeq, z: majorDimSeq};
        pWidth = plane.max.z - plane.min.z;
        pHeight = plane.max.y - plane.min.y;
        pTileWidth = stack.tileSource.tileWidth * stack.resolution.z;
        pTileHeight = stack.tileSource.tileHeight * stack.resolution.y;
        break;
    }

    if (tileZoomLevel) {
      // Scale project tile width to the requested zoom level
      var scale = Math.pow(2, tileZoomLevel);
      pTileWidth *= scale;
      pTileHeight *= scale;
      // Create two triangles for every tile
      var tileWidth = stack.tileSource.tileWidth;
      var tileHeight = stack.tileSource.tileHeight;
      var nHTiles = getNZoomedParts(stack.dimension.x, tileZoomLevel, tileWidth);
      var nVTiles = getNZoomedParts(stack.dimension.y, tileZoomLevel, tileHeight);
      var transpose = stack.tileSource.transposeTiles &&
          stack.tileSource.transposeTiles.has(stack.orientation);

      // Use THREE's plane geometry so that UVs and normals are set up aleady.
      var tilePlaneWidth = nHTiles * pTileWidth;
      var tilePlaneHeight = nVTiles * pTileHeight;

      // Get four corners of z plane: lower left, lower right,
      // upper left, upper right
      var planeVertices = new Array(4);
      for (var i = 0; i < 4; ++i) {
        planeVertices[i] = new THREE.Vector3(plane[seq.x[i]].x,
            plane[seq.y[i]].y, plane[seq.z[i]].z);
      }
      var hTileStep = planeVertices[1].clone().sub(planeVertices[0]).setLength(pTileWidth);
      var vTileStep = planeVertices[0].clone().sub(planeVertices[2]).setLength(pTileHeight);

      // Calculate some required tile overflow information
      var overflowH = tilePlaneWidth - pWidth;
      var overflowHCoRatio = 1 - overflowH / pTileWidth;
      var overflowV = tilePlaneHeight - pHeight;
      var overflowVCoRatio = 1 - overflowV / pTileHeight;

      // This will become the z plane.
      geometry = new THREE.PlaneGeometry(tilePlaneWidth, tilePlaneHeight, nHTiles, nVTiles);
      var tileVertices = new Array(4);
      for (var r=0; r<nVTiles; ++r) {
        for (var c=0; c<nHTiles; ++c) {
          var tileIndex = r * nHTiles + c;
          var faceIndex = tileIndex * 2;
          var face1 = geometry.faces[faceIndex];
          var face2 = geometry.faces[faceIndex + 1];
          var isLastCol = (c === nHTiles - 1);
          var isLastRow = (r === nVTiles - 1);
          var hTileFrac = isLastCol ? overflowHCoRatio : 1;
          var vTileFrac = isLastRow ? overflowVCoRatio : 1;

          // Move vertices to actual positions and clamp last row as well as
          // last column to stack bounds.
          var vertices = geometry.vertices;
          var ul = vertices[face1.a].copy(planeVertices[0])
              .addScaledVector(hTileStep, c)
              .addScaledVector(vTileStep,  -r);
          var ll = vertices[face1.b].copy(planeVertices[0])
              .addScaledVector(hTileStep, c)
              .addScaledVector(vTileStep, -r - vTileFrac);
          var lr = vertices[face2.b].copy(planeVertices[0])
              .addScaledVector(hTileStep, c + hTileFrac)
              .addScaledVector(vTileStep, -r - vTileFrac);
          var ur = vertices[face2.c].copy(planeVertices[0])
              .addScaledVector(hTileStep, c + hTileFrac)
              .addScaledVector(vTileStep, -r);

          // Set different material index for each tile
          face1.materialIndex = tileIndex;
          face2.materialIndex = tileIndex;

          // Set UVs so that our image tiles map nicely on our triangles
          var uvs1 = geometry.faceVertexUvs[0][faceIndex];
          var uvs2 = geometry.faceVertexUvs[0][faceIndex + 1];

          // Set UVs and clamp UVs of last row and column to stack bounds.
          uvs1[0].set(0, 1);
          uvs1[1].set(0, 1 - vTileFrac);
          uvs1[2].set(hTileFrac, 1);
          uvs2[0].set(0, 1 - vTileFrac);
          uvs2[1].set(hTileFrac, 1 - vTileFrac);
          uvs2[2].set(hTileFrac, vTileFrac);
        }
      }
      geometry.verticesNeedUpdate = true;
      geometry.uvsNeedUpdate = true;

      // If the stack tiles for this stack are transposed, its dimensions are
      // swapped and the stack has to be rotated by 90 degees.
      if (transpose) {
        // Mirror image diagonally
        var axis = planeVertices[3].clone().sub(planeVertices[0]).normalize();
        var rotation = new THREE.Matrix4();
        rotation.makeRotationAxis(axis, -Math.PI);
        geometry.applyMatrix(rotation);
      }
    } else {
      // Push vertices for lower left, lower right, upper left, upper right
      geometry = new THREE.Geometry();
      for (var i = 0; i < 4; ++i) {
        geometry.vertices.push( new THREE.Vector3( plane[seq.x[i]].x,
              plane[seq.y[i]].y, plane[seq.z[i]].z ) );
      }
      geometry.faces.push( new THREE.Face3( 0, 1, 2 ) );
      geometry.faces.push( new THREE.Face3( 1, 2, 3 ) );
    }

    return geometry;
  };

  /**
   * Destroy an existing z plane and replace it with a new one.
   *
   * @param {Object}  space            Space to which the z plane should be added to
   * @param {Object}  stackViewer      The stack viewer to create z plane for
   * @param {Integer} textureZoomLevel (Optional) The zoom level used for
   *                                   image tile texture. If set to "max", the
   *                                   stack's maximum zoom level is used. If
   *                                   null/undefined, no texture will be used.
   * @param {Number}  opacity          A value in the range 0-1 representing the
   *                                   opacity of the z plane.
   */
  WebGLApplication.prototype.Space.prototype.StaticContent.prototype.createZPlane =
      function(space, stackViewer, textureZoomLevel, opacity) {
    if (this.zplane) space.scene.remove(this.zplane);

    if ("max" === textureZoomLevel) {
      textureZoomLevel = stackViewer.primaryStack.MAX_S;
    }
    // Create geometry for plane
    var geometry = this.createPlaneGeometry(stackViewer.primaryStack, textureZoomLevel);

    if (textureZoomLevel || 0 === textureZoomLevel) {
      // Remember zoom level for updates
      this.zplaneZoomLevel = textureZoomLevel;
      // Every tile in the z plane is made out of two triangles.
      this.zplaneMaterials = new Array(geometry.faces.length / 2);
      for (var i=0; i<this.zplaneMaterials.length; ++i) {
        this.zplaneMaterials[i] = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          side: THREE.DoubleSide,
          opacity: opacity,
          transparent: true
        });
      }
      this.zplane = new THREE.Mesh(geometry, new THREE.MultiMaterial(this.zplaneMaterials));
    } else {
      var material = new THREE.MeshBasicMaterial({
        color: 0x151349, side: THREE.DoubleSide, opacity: opacity, transparent: true});
      this.zplane = new THREE.Mesh(geometry, material);
      this.zplaneMaterials = null;
    }

    space.scene.add(this.zplane);

    this.updateZPlanePosition(space, stackViewer);
  };

  var getNZoomedParts = function(width, zoom, part) {
    return Math.floor((width * Math.pow(2, -zoom) - 1) / part) + 1;
  };

  WebGLApplication.prototype.Space.prototype.StaticContent.prototype.updateZPlanePosition = function(space, stackViewer) {
    if (this.zplane) {
      var stack = stackViewer.primaryStack;
      var v = new THREE.Vector3(0, 0, 0);
      switch (stackViewer.primaryStack.orientation) {
        case CATMAID.Stack.ORIENTATION_XY:
          v.z = stack.stackToProjectZ(stackViewer.z, stackViewer.y, stackViewer.x);
          break;
        case CATMAID.Stack.ORIENTATION_XZ:
          v.y = stack.stackToProjectY(stackViewer.z, stackViewer.y, stackViewer.x);
          break;
        case CATMAID.Stack.ORIENTATION_ZY:
          v.x = stack.stackToProjectX(stackViewer.z, stackViewer.y, stackViewer.x);
          break;
      }
      this.zplane.position.copy(v);

      // Also update tile texture
      if (this.zplaneMaterials) {
        var tileSource = stack.tileSource;
        // To get arround potential CORS restrictions load tile into image and
        // then into texture.
        var loadTile = function(texture, material, notify) {
          material.map = texture;
          texture.needsUpdate = true;
          material.needsUpdate = true;
          notify();
        };

        var counter = this.zplaneMaterials.length;
        var notify = function() {
          counter = counter - 1;
          if (0 === counter) {
            space.render();
          }
        };

        var zoomLevel = this.zplaneZoomLevel;
        var nCols = getNZoomedParts(stack.dimension.x, zoomLevel, tileSource.tileWidth);
        for (var i=0; i<this.zplaneMaterials.length; ++i) {
          var material = this.zplaneMaterials[i];
          var image = new Image();
          image.crossOrigin = true;
          var texture = new THREE.Texture(image);
          image.onload = loadTile.bind(this, texture, material, notify);

          var slicePixelPosition = [stackViewer.z];
          var col = i % nCols;
          var row = (i - col) / nCols;
          image.src = tileSource.getTileURL(project.id, stack,
              slicePixelPosition, col, row, zoomLevel);
        }

        this.zplane.material.needsUpdate = true;
      }
    }
  };

  /** Returns an array of meshes representing the missing sections. */
  WebGLApplication.prototype.Space.prototype.StaticContent.prototype.createMissingSections = function(stack, missing_section_height) {
    var geometry = this.createPlaneGeometry(stack),
        materials = [new THREE.MeshBasicMaterial( { color: 0x151349, opacity:0.6, transparent: true, side: THREE.DoubleSide } ),
                     new THREE.MeshBasicMaterial( { color: 0x00ffff, wireframe: true, wireframeLinewidth: 5, side: THREE.DoubleSide } )];

    // Use scaling to set missing section height.
    var scale = {x: 1, y: 1, z: 1};
    switch (stack.orientation) {
      case CATMAID.Stack.ORIENTATION_XY:
        scale.y = missing_section_height / 100;
        break;
      case CATMAID.Stack.ORIENTATION_XZ:
        scale.z = missing_section_height / 100;
        break;
      case CATMAID.Stack.ORIENTATION_ZY:
        scale.y = missing_section_height / 100;
        break;
    }

    return stack.broken_slices.reduce(function(missing_sections, sliceStackZ) {
      var x = stack.stackToProjectX(sliceStackZ, 0, 0),
          y = stack.stackToProjectY(sliceStackZ, 0, 0),
          z = stack.stackToProjectZ(sliceStackZ, 0, 0);
      return missing_sections.concat(materials.map(function(material) {
        var mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y, z);
        mesh.scale.set(scale.x, scale.y, scale.z);
        return mesh;
      }));
    }, []);
  };

  /**
   * Constructor for an object that manages the content in a scene.
   */
  WebGLApplication.prototype.Space.prototype.Content = function(options) {
    // A representation of the active node
    this.active_node = new this.ActiveNode(options);
    // A list of extra meshes
    this.meshes = [];
    // Map of skeleton IDs to skeleton representations
    this.skeletons = {};
  };

  WebGLApplication.prototype.Space.prototype.Content.prototype = {};

  WebGLApplication.prototype.Space.prototype.Content.prototype.dispose = function() {
    this.active_node.mesh.geometry.dispose();
    this.active_node.mesh.material.dispose();

    this.meshes.forEach(function(mesh) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
  };

  WebGLApplication.prototype.Space.prototype.Content.prototype.loadMeshes = function(space, submit, material) {
    submit(django_url + project.id + "/stack/" + space.stack.id + "/models",
           'POST',
           {},
           function (models) {
             var ids = Object.keys(models);
             if (0 === ids.length) return;
             var loader = space.content.newJSONLoader();
             ids.forEach(function(id) {
               var vs = models[id].vertices;
               var geometry = loader.parse(models[id]).geometry;
               var mesh = space.content.newMesh(geometry, material);
               mesh.position.set(0, 0, 0);
               mesh.rotation.set(0, 0, 0);
               space.content.meshes.push(mesh);
               space.add(mesh);
             });
             space.render();
          });
  };

  WebGLApplication.prototype.Space.prototype.Content.prototype.newMesh = function(geometry, material) {
    return new THREE.Mesh(geometry, material);
  };

  WebGLApplication.prototype.Space.prototype.Content.prototype.newJSONLoader = function() {
    return new THREE.JSONLoader(true);
  };

  /** Adjust content according to the persistent options. */
  WebGLApplication.prototype.Space.prototype.Content.prototype.adjust = function(options, space, submit) {
    if (options.show_meshes) {
      if (0 === this.meshes.length) {
        this.loadMeshes(space, submit, options.createMeshMaterial());
      }
    } else {
      this.meshes.forEach(function(m) { this.remove(m); }, space.scene);
      this.meshes = [];
    }

    this.active_node.mesh.material.depthTest = !options.active_node_on_top;
    this.active_node.setVisible(options.show_active_node);
    this.active_node.updatePosition(space, options);
  };

  WebGLApplication.prototype.Space.prototype.View = function(space) {
    this.space = space;

    this.init();

    // Initial view
    this.XY();
  };

  WebGLApplication.prototype.Space.prototype.View.prototype = {};

  WebGLApplication.prototype.Space.prototype.View.prototype.init = function() {
    /* Create a camera which generates a picture fitting in our canvas. The
    * frustum's far culling plane for the perspective camera is very far away.
    * This is needed to avoid some strange clipping of the floor geometry when a
    * logarithmic depth buffer is used (what we do). */
    var fov = 75;
    var d = this.space.dimensions;
    var regularFarPlane = 5 * Math.max(Math.abs(d.max.x - d.min.x),
                              Math.max(Math.abs(d.max.y - d.min.y),
                                       Math.abs(d.max.z - d.min.z)));
    var near = 1;
    var far = this.logDepthBuffer ? 1e27 : regularFarPlane;
    var orthoNear = -regularFarPlane;
    var orthoFar = regularFarPlane;

    this.logDepthBuffer = true;
    this.mainCamera = new THREE.CombinedCamera(-this.space.canvasWidth,
        -this.space.canvasHeight, fov, near, far, orthoNear, orthoFar);
    this.mainCamera.frustumCulled = false;

    this.camera = this.mainCamera;

    this.debugCamera = new THREE.CombinedCamera(-this.space.canvasWidth,
        -this.space.canvasHeight, fov, 1e-6, 1e27, orthoNear, orthoFar);
    this.debugCamera.position.x = 2 * d.max.x;
    this.debugCamera.position.y = -2 * d.max.y;
    this.debugCamera.position.z = 2 * d.max.z;
    this.debugCamera.up.set(0, -1, 0);
    this.debugCamera.lookAt(this.space.center);

    this.projector = new THREE.Projector();

    this.mouse = {position: new THREE.Vector2(),
                  is_mouse_down: false};

    this.initRenderer();

    // Create controls after the renderer's DOM element has been added, so they
    // are initialized with the correct dimensions right from the start.
    this.controls = this.createControls();
  };

  /**
   * Create a new renderer and add its DOM element to the 3D viewer's container
   * element. If there is already a renderer, remove its DOM element and
   * handlers on it.
   */
  WebGLApplication.prototype.Space.prototype.View.prototype.initRenderer = function() {
    var clearColor = null;
    // Remove existing elements if there is a current renderer
    if (this.renderer) {
      this.space.container.removeChild(this.renderer.domElement);
      this.mouseControls.detach(this.renderer.domElement);
      // Save clear color
      clearColor = this.renderer.getClearColor();
    }

    this.renderer = this.createRenderer('webgl');
    if (clearColor) {
      this.renderer.setClearColor(clearColor);
    }

    this.space.container.appendChild(this.renderer.domElement);
    this.mouseControls = new this.MouseControls();
    this.mouseControls.attach(this, this.renderer.domElement);

    // Add handlers for WebGL context lost and restore events
    this.renderer.context.canvas.addEventListener('webglcontextlost', function(e) {
      e.preventDefault();
      // Notify user about reload
      CATMAID.error("Due to limited system resources the 3D display can't be " +
            "shown right now. Please try and restart the widget containing the " +
            "3D viewer.");
    }, false);
    this.renderer.context.canvas.addEventListener('webglcontextrestored', (function(e) {
      this.initRenderer();
    }).bind(this), false);
  };


  /**
   * Crate and setup a WebGL or SVG renderer.
   */
  WebGLApplication.prototype.Space.prototype.View.prototype.createRenderer = function(type) {
    var renderer = null;
    if ('webgl' === type) {
      renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: this.logDepthBuffer });
    } else if ('svg' === type) {
      renderer = new THREE.SVGRenderer();
    } else {
      CATMAID.error("Unknon renderer type: " + type);
      return null;
    }

    renderer.sortObjects = false;
    renderer.setSize( this.space.canvasWidth, this.space.canvasHeight );

    return renderer;
  };

  WebGLApplication.prototype.Space.prototype.View.prototype.destroy = function() {
    this.mouseControls.detach(this.renderer.domElement);
    this.space.container.removeChild(this.renderer.domElement);
    Object.keys(this).forEach(function(key) { delete this[key]; }, this);
  };

  WebGLApplication.prototype.Space.prototype.View.prototype.createControls = function() {
    var controls = new THREE.TrackballControls( this.camera, this.space.container );
    controls.rotateSpeed = 1.0;
    controls.zoomSpeed = 3.2;
    controls.panSpeed = 1.5;
    controls.noZoom = true;
    controls.noPan = false;
    controls.staticMoving = true;
    controls.dynamicDampingFactor = 0.3;
    controls.target = this.space.center.clone();
    return controls;
  };

  WebGLApplication.prototype.Space.prototype.View.prototype.render = function() {
    if (this.controls) {
      this.controls.update();
    }
    if (this.renderer) {
      this.renderer.clear();
      this.renderer.render(this.space.scene, this.camera);
    }
  };

  /**
   * Get the toDataURL() image data of the renderer in PNG format.
   */
  WebGLApplication.prototype.Space.prototype.View.prototype.getImageData = function(type) {
    type = type || "image/png";
    return this.renderer.domElement.toDataURL(type);
  };

  /**
   * Return SVG data of the rendered image. The rendered scene is slightly
   * modified to not include the triangle-heavy spheres. Instead, these spheres
   * are replaced with very short lines with a width that corresponds to the
   * diameter of the sphers.
   *
   * If createCatalog is true, a catalog representation is crated where each
   * neuron will be rendered in its own view, organized in a table.
   */
  WebGLApplication.prototype.Space.prototype.View.prototype.getSVGData = function(options) {
    var self = this;
    var o = options || {};

    // Find all spheres
    var fields = ['radiusVolumes'];
    var skeletons = this.space.content.skeletons;
    var visibleSpheres = Object.keys(skeletons).reduce(function(o, skeleton_id) {
      var skeleton = skeletons[skeleton_id];
      if (!skeleton.visible) return o;

      var meshes = [];

      // Append all spheres
      fields.map(function(field) {
        return skeleton[field];
      }).forEach(function(spheres) {
        Object.keys(spheres).forEach(function(id) {
          var sphere = spheres[id];
          if (sphere.visible) {
            this.push(sphere);
          }
        }, this);
      }, meshes);

      // Append all individual buffer objects to be able to create replacements
      // for them. The whole buffers added below are only used to make all
      // objects of this bufffer invisible for rendering (doesn't work with with
      // the meshes only in SVG renderer).
      var bufferObjects = [];
      var bufferConnectorSpheres = skeleton['synapticSpheres'];
      for (var id in bufferConnectorSpheres) {
        var bo = bufferConnectorSpheres[id];
        bufferObjects.push(bo);
      }
      var bufferSpheres = skeleton['specialTagSpheres'];
      for (var id in bufferSpheres) {
        var bo = bufferSpheres[id];
        bufferObjects.push(bo);
      }

      o.meshes[skeleton_id] = meshes;
      o.bufferObjects[skeleton_id] = bufferObjects;
      o.buffers[skeleton_id] = [];
      if (skeleton.specialTagSphereCollection)
        o.buffers[skeleton_id].push(skeleton.specialTagSphereCollection);
      if (skeleton.connectorSphereCollection)
        o.buffers[skeleton_id].push(skeleton.connectorSphereCollection);

      return o;
    }, {
      meshes: {},
      bufferObjects: {},
      buffers: {}
    });

    // Hide the active node
    var atnVisible = self.space.content.active_node.mesh.visible;
    self.space.content.active_node.mesh.visible = false;

    // Render
    var svgData = null;
    if ('catalog' === o['layout']) {
      svgData = createCatalogData(visibleSpheres.meshes,
          visibleSpheres.bufferObjects, visibleSpheres.buffers, o);
    } else {
      svgData = renderSkeletons(visibleSpheres.meshes,
          visibleSpheres.bufferObjects, visibleSpheres.buffers);
    }

    // Show active node, if it was visible before
    self.space.content.active_node.mesh.visible = atnVisible;

    // Let 3D viewer update
    self.space.render();

    return svgData;

    /**
     * Set visibility of the given meshes.
     */
    function setVisibility(meshes, value)
    {
      // Hide all sphere meshes
      meshes.forEach(function(mesh) {
        mesh.visible = value;
      });
    }

    function addSphereReplacements(meshes, buffers, scene)
    {
      // Spheres will be replaced with very short lines
      var geometry = new THREE.Geometry();
      geometry.vertices.push(new THREE.Vector3(0, 0, 0));
      geometry.vertices.push(new THREE.Vector3(0, 0, 1));
      geometry.computeLineDistances();

      var addedData = {
        m: {},
        g: geometry,
        d: []
      };

      var tmp = new THREE.Vector3();
      var line = new THREE.Line3();
      // Use the camera's up vector to constuct a normalized vector embedded in
      // the screen space plane.
      var up = self.camera.up.clone().normalize();
      if (meshes) {
        var meshReplacements = meshes.map(function(mesh) {
          var hex = mesh.material.color.getHexString();
          // Get radius of sphere in 3D world coordinates, but only use a 3x3 world
          // matrix, since we don't need the translation.
          if (mesh instanceof THREE.Mesh) {
            tmp.set(mesh.geometry.boundingSphere.radius, 0, 0)
              .applyMatrix3(mesh.matrixWorld).length();
          } else {
            tmp.set(mesh.radius, 0, 0);
          }
          var r = tmp.length();
          // The radius has to be corrected for perspective
          var sr = tmp.copy(up).multiplyScalar(r);
          line.set(mesh.position.clone(), sr.add(mesh.position));
          line.start.project(self.camera);
          line.end.project(self.camera);
          // The projected line distance is given in a screen space that ranges from
          // (-1,-1) to (1,1). We therefore have to divide by 2 to get a normalized
          // value that we can use to create actual screen distances.  For the final
          // length, there is no need to be more precise than 1 decimal
          var l = (0.5 * line.distance() * self.space.canvasWidth).toFixed(1);
          // Get material from index or create a new one
          var key = hex + "-" + l;
          var material = this.m[key];
          if (!material) {
            material = new THREE.LineBasicMaterial({
              color: mesh.material.color.clone(),
              opacity: mesh.material.opacity,
              linewidth: l
            });
            this.m[key] = material;
          }
          var newMesh = new THREE.LineSegments( this.g, material );
          // Move new mesh to position of replaced mesh and adapt size
          newMesh.position.copy(mesh.position);
          scene.add(newMesh);
          return newMesh;
        }, addedData);

        addedData.d = addedData.d.concat(meshReplacements);
      }


      if (buffers) {
        var bufferReplacements = buffers.filter(function(buffer) {
          return buffer.visible;
        }).map(function(buffer) {
          var hex = buffer.color.getHexString();
          tmp.set(buffer.boundingSphere.radius, 0, 0);
          var r = tmp.length();
          // The radius has to be corrected for perspective
          var sr = tmp.copy(up).multiplyScalar(r);
          line.set(buffer.position.clone(), sr.add(buffer.position));
          line.start.project(self.camera);
          line.end.project(self.camera);
          // The projected line distance is given in a screen space that ranges from
          // (-1,-1) to (1,1). We therefore have to divide by 2 to get a normalized
          // value that we can use to create actual screen distances.  For the final
          // length, there is no need to be more precise than 1 decimal
          var l = (0.5 * line.distance() * self.space.canvasWidth).toFixed(1);
          // Get material from index or create a new one
          var key = hex + "-" + l;
          var material = this.m[key];
          if (!material) {
            material = new THREE.LineBasicMaterial({
              color: buffer.color.clone(),
              opacity: buffer.alpha,
              linewidth: l
            });
            this.m[key] = material;
          }
          var newMesh = new THREE.LineSegments( this.g, material );
          // Move new mesh to position of replaced mesh and adapt size
          newMesh.position.copy(buffer.position);
          scene.add(newMesh);
          return newMesh;
        }, addedData);

        addedData.d = addedData.d.concat(bufferReplacements);
      }

      return addedData;
    }

    function removeSphereReplacements(addedData, scene)
    {
      addedData.d.forEach(function(m) { scene.remove(m); });
      Object.keys(addedData.m).forEach(function(m) {
        this[m].dispose();
      }, addedData.m);
      addedData.g.dispose();
    }

    /**
     * Create an SVG catalog of the current view.
     */
    function createCatalogData(sphereMeshes, bufferObjects, sphereBuffers, options)
    {
      // Sort skeletons
      var skeletons;
      if (options['skeletons']) {
        // Make sure all requested skeletons are actually part of the 3D view
        var existingSkids = Object.keys(self.space.content.skeletons);
        options['skeletons'].forEach(function(s) {
          if (-1 === existingSkids.indexOf(s)) {
            throw "Only skeletons currently loaded in the 3D viewer can be exported";
          }
        });
        skeletons = options['skeletons'];
      } else {
        // If no skeletons where given, don't try to sort
        skeletons = Object.keys(self.space.content.skeletons);
      }

      // SVG namespace to use
      var namespace = 'http://www.w3.org/2000/svg';
      // Size of the label text
      var fontsize = options['fontsize'] || 14;
      var displayNames = options['displaynames'] === undefined ? true : options['displaynames'];

      // Margin of whole document
      var margin = options['margin'] || 10;
      // Padding around each sub-svg
      var padding = options['padding'] || 10;

      var imageWidth = self.space.canvasWidth;
      var imageHeight = self.space.canvasHeight;
      var numColumns = options['columns'] || 2;
      var numRows = Math.ceil(skeletons.length / numColumns);

      // Crate a map of current visibility
      var visibilityMap = self.space.getVisibilityMap();

      // Append missing pinned skeletons
      var visibleSkids = options['pinnedSkeletons'] || [];

      // Iterate over skeletons and create SVG views
      var views = {};
      for (var i=0, l=skeletons.length; i<l; ++i) {
        var skid = skeletons[i];
        // Display only current skeleton along with pinned ones
        visibleSkids.push(skid);
        self.space.setSkeletonVisibility(visibilityMap, visibleSkids);

        // Render view and replace sphere meshes of current skeleton
        var spheres = visibleSkids.reduce(function(o, s) {
          o.meshes[s] = sphereMeshes[s];
          o.buffers[s] = sphereBuffers[s];
          o.bufferObjects[s] = bufferObjects[s];
          return o;
        }, {
          meshes: {},
          bufferObjects: {},
          buffers: {}
        });
        var svg = renderSkeletons(spheres.meshes, spheres.bufferObjects, spheres.buffers);

        if (displayNames) {
          // Add name of neuron
          var text = document.createElementNS(namespace, 'text');
          text.setAttribute('x', svg.viewBox.baseVal.x + 5);
          text.setAttribute('y', svg.viewBox.baseVal.y + fontsize + 5);
          text.setAttribute('style', 'font-family: Arial; font-size: ' + fontsize + 'px;');
          var name = CATMAID.NeuronNameService.getInstance().getName(skid);
          text.appendChild(document.createTextNode(name));
          svg.appendChild(text);
        }

        // Remove current skeleton again from visibility list
        visibleSkids.pop();

        // Store
        views[skid] = svg;
      }

      // Restore visibility
      self.space.setSkeletonVisibility(visibilityMap);

      // Create result svg
      var svg = document.createElement('svg');
      svg.setAttribute('xmlns', namespace);
      svg.setAttribute('width', 2 * margin + numColumns * (imageWidth + 2 * padding));
      svg.setAttribute('height', 2 * margin + numRows * (imageHeight + 2 * padding));

      // Title
      var title = document.createElementNS(namespace, 'title');
      title.appendChild(document.createTextNode(options['title'] || 'CATMAID neuron catalog'));
      svg.appendChild(title);

      // Combine all generated SVGs into one
      for (var i=0, l=skeletons.length; i<l; ++i) {
        var skid = skeletons[i];
        var data = views[skid];

        // Add a translation to current image
        var col = i % numColumns;
        var row = Math.floor(i / numColumns);
        data.setAttribute('x', margin + col * imageWidth + (col * 2 + 1) * padding);
        data.setAttribute('y', margin + row * imageHeight + (row * 2 * padding) + padding);

        // Append the group to the SVG
        svg.appendChild(data);
      }

      return svg;
    }

    /**
     * Render the current scene and replace the given sphere meshes beforehand.
     */
    function renderSkeletons(sphereMeshes, bufferObjects, bufferCollections)
    {
      // Hide spherical meshes of all given skeletons
      var sphereReplacemens = {};
      for (var skid in sphereMeshes) {
        var meshes = sphereMeshes[skid];
        var bufferObjects = bufferObjects[skid];
        var buffers = bufferCollections[skid];
        setVisibility(meshes, false);
        setVisibility(buffers, false);
        sphereReplacemens[skid] = addSphereReplacements(meshes, bufferObjects, self.space);
      }

      // Create a new SVG renderer (which is faster than cleaning an existing one)
      // and render the image
      var svgRenderer = self.createRenderer('svg');
      svgRenderer.clear();
      svgRenderer.render(self.space.scene, self.camera);

      // Show spherical meshes again and remove substitutes
      for (skid in sphereMeshes) {
        var mesh = sphereMeshes[skid];
        var buffers = bufferCollections[skid];
        removeSphereReplacements(sphereReplacemens[skid], self.space);
        setVisibility(mesh, true);
        setVisibility(buffers, true);
      }

      return svgRenderer.domElement;
    }
  };

  /**
   * Set camera position so that the whole XY side of the bounding box facing +Z
   * can just be seen.
   */
  WebGLApplication.prototype.Space.prototype.View.prototype.XY = function() {
    var center = this.space.center,
        dimensions = this.space.dimensions,
        vFOV = this.camera.fov * Math.PI / 180,
        bbDistance;
    if (this.height > this.width) {
      var hFOV = 2 * Math.atan( Math.tan( vFOV * 0.5 ) * this.width / this.height );
      bbDistance = (dimensions.max.x - dimensions.min.x) * 0.5 / Math.tan(hFOV * 0.5);
    } else {
      bbDistance = (dimensions.max.y - dimensions.min.y) * 0.5 / Math.tan(vFOV * 0.5);
    }
    this.controls.target = center;
    this.camera.position.x = center.x;
    this.camera.position.y = center.y;
    this.camera.position.z = center.z - (dimensions.max.z / 2) - bbDistance;
    this.camera.up.set(0, -1, 0);
  };

  /**
   * Set camera position so that the whole XZ side of the bounding box facing +Y
   * can just be seen.
   */
  WebGLApplication.prototype.Space.prototype.View.prototype.XZ = function() {
    var center = this.space.center,
        dimensions = this.space.dimensions,
        vFOV = this.camera.fov * Math.PI / 180,
        bbDistance;
    if (this.height > this.width) {
      var hFOV = 2 * Math.atan( Math.tan( vFOV * 0.5 ) * this.width / this.height );
      bbDistance = (dimensions.max.x - dimensions.min.x) * 0.5 / Math.tan(hFOV * 0.5);
    } else {
      bbDistance = (dimensions.max.z - dimensions.min.z) * 0.5 / Math.tan(vFOV * 0.5);
    }
    this.controls.target = center;
    this.camera.position.x = center.x;
    this.camera.position.y = center.y - (dimensions.max.y / 2) - bbDistance;
    this.camera.position.z = center.z;
    this.camera.up.set(0, 0, -1);
  };

  /**
   * Set camera position so that the whole ZY side of the bounding box facing +X
   * can just be seen.
   */
  WebGLApplication.prototype.Space.prototype.View.prototype.ZY = function() {
    var center = this.space.center,
        dimensions = this.space.dimensions,
        vFOV = this.camera.fov * Math.PI / 180,
        bbDistance;
    if (this.height > this.width) {
      var hFOV = 2 * Math.atan( Math.tan( vFOV * 0.5 ) * this.width / this.height );
      bbDistance = (dimensions.max.z - dimensions.min.z) * 0.5 / Math.tan(hFOV * 0.5);
    } else {
      bbDistance = (dimensions.max.y - dimensions.min.y) * 0.5 / Math.tan(vFOV * 0.5);
    }
    this.controls.target = center;
    this.camera.position.x = center.x + (dimensions.max.x / 2) + bbDistance;
    this.camera.position.y = center.y;
    this.camera.position.z = center.z;
    this.camera.up.set(0, -1, 0);
  };

  /**
   * Set camera position so that the whole ZX side of the bounding box facing +Y
   * can just be seen.
   */
  WebGLApplication.prototype.Space.prototype.View.prototype.ZX = function() {
    var center = this.space.center,
        dimensions = this.space.dimensions,
        vFOV = this.camera.fov * Math.PI / 180,
        bbDistance;
    if (this.height > this.width) {
      var hFOV = 2 * Math.atan( Math.tan( vFOV * 0.5 ) * this.width / this.height );
      bbDistance = (dimensions.max.z - dimensions.min.z) * 0.5 / Math.tan(hFOV * 0.5);
    } else {
      bbDistance = (dimensions.max.x - dimensions.min.x) * 0.5 / Math.tan(vFOV * 0.5);
    }
    this.controls.target = center;
    this.camera.position.x = center.x;
    this.camera.position.y = center.y - (dimensions.max.y / 2) - bbDistance;
    this.camera.position.z = center.z;
    this.camera.up.set(-1, 0, 0);
  };

  /**
   * Get properties of current view.
   */
  WebGLApplication.prototype.Space.prototype.View.prototype.getView = function() {
    return {
      target: this.controls.target.clone(),
      position: this.camera.position.clone(),
      up: this.camera.up.clone(),
      zoom: this.camera.zoom,
      orthographic: this.camera.inOrthographicMode,
    };
  };

  /**
   * Set properties of current view.
   *
   * @param {THREE.Vector3} target - the target of the camera
   * @param {THREE.Vector3} position - the position of the camera
   * @param {THREE.Vector3} up - up direction
   */
  WebGLApplication.prototype.Space.prototype.View.prototype.setView = function(target, position, up, zoom, orthographic) {
    this.controls.target.copy(target);
    this.camera.position.copy(position);
    this.camera.up.copy(up);
    this.camera.zoom = zoom;
    this.setCameraMode(orthographic);
  };

  /**
   * Make the camera act as a perspective or an orthographic camera.
   *
   * @param {Boolean} orthographic - use orthographic or perspective mode
   */
  WebGLApplication.prototype.Space.prototype.View.prototype.setCameraMode = (function() {
    // Store the original far plane distance of the perspective camera privately.
    var originalFarPlaneP;

    // If a logarithmic depth buffer is used, the perspective camera's far
    // clipping plane has to be changed while the camera is set to
    // orthographic mode. This is because the perspective camera's far
    // clipping plan is used to calculate the orthographic camera's view
    // (initially as well as for later updates like zoom. Unfortunately, we
    // can't use a closer far clipping with logarithmic depth buffers (or some
    // strange near field clipping is happening).
    return function(orthographic) {
      if(orthographic) {
        if (this.logDepthBuffer) {
          originalFarPlaneP = this.camera.cameraP.far;
          this.camera.cameraP.far = this.camera.cameraO.far;
        }
        this.logDepthBuffer = false;
        this.camera.toOrthographic();
      } else {
        if (this.logDepthBuffer && originalFarPlaneP) {
          this.camera.cameraP.far = originalFarPlaneP;
        }
        this.logDepthBuffer = true;
        this.camera.toPerspective();
      }
      // Since we use different depth buffer types for perspective and
      // orthographic mode, the rendeer has to be re-initialized.
      this.initRenderer();
    };
  })();

  /** Construct mouse controls as objects, so that no context is retained. */
  WebGLApplication.prototype.Space.prototype.View.prototype.MouseControls = function() {

    this.attach = function(view, domElement) {
      domElement.CATMAID_view = view;

      domElement.addEventListener('wheel', this.MouseWheel, false);
      domElement.addEventListener('mousemove', this.MouseMove, false);
      domElement.addEventListener('mouseup', this.MouseUp, false);
      domElement.addEventListener('mousedown', this.MouseDown, false);
    };

    this.detach = function(domElement) {
      domElement.CATMAID_view = null;
      delete domElement.CATMAID_view;

      domElement.removeEventListener('wheel', this.MouseWheel, false);
      domElement.removeEventListener('mousemove', this.MouseMove, false);
      domElement.removeEventListener('mouseup', this.MouseUp, false);
      domElement.removeEventListener('mousedown', this.MouseDown, false);

      Object.keys(this).forEach(function(key) { delete this[key]; }, this);
    };

    /**
     * Modifies the zoom (and therefore the effective focal length) of the camera.
     * If the Ctrl-key is pressed and the camera is not in orthographic mode, the
     * camera (and target) is moved instead.
     */
    this.MouseWheel = function(ev) {
      if (this.CATMAID_view.space.options.lock_view) return;

      var camera = this.CATMAID_view.camera;
      if ((ev.ctrlKey || ev.altKey) && !camera.inOrthographicMode) {
        // Move the camera and the target in target direction
        var absUpdateDistance = 3500;
        var movingForward = ev.wheelDelta > 0;
        var dirFactor = movingForward ? -1 : 1;
        var distance = absUpdateDistance * dirFactor;
        var controls = this.CATMAID_view.controls;
        var change = new THREE.Vector3().copy(camera.position)
          .sub(controls.target);

        // If the distance to the target is smaller than the distance the camera
        // should move toward the target and we are moving forward, update the
        // moving distance to be half the target distance.
        var camTargetDistance = change.length();
        if (camTargetDistance < absUpdateDistance && movingForward) {
          absUpdateDistance = camTargetDistance * 0.5;
          distance = absUpdateDistance * dirFactor;
          // And cancel the location update if we are closer than ten units
          // (arbitary close distance).
          if (camTargetDistance - absUpdateDistance < 10) {
            return;
          }
        }

        // Scale change vector into usable range
        change.normalize().multiplyScalar(distance);
        camera.position.add(change);

        // Move the target only if Alt was pressed
        if (ev.altKey) {
          controls.target.add(change);
        }
      } else {
        // The distance to the target does not make any difference for an
        // orthographic projection, the depth is fixed.
        var new_zoom = camera.zoom;
        if ((ev.deltaX + ev.deltaY) < 0) {
          new_zoom += 0.25;
        } else {
          new_zoom -= 0.25;
        }
        new_zoom = Math.max(new_zoom, 1.0);
        camera.setZoom( new_zoom );
      }

      this.CATMAID_view.space.render();
    };

    this.MouseMove = function(ev) {
      var mouse = this.CATMAID_view.mouse,
          space = this.CATMAID_view.space;
      if (!space.options.lock_view) {
        mouse.position.x =  ( ev.offsetX / space.canvasWidth  ) * 2 -1;
        mouse.position.y = -( ev.offsetY / space.canvasHeight ) * 2 +1;

        if (mouse.is_mouse_down) {
          space.render();
        }
      }

      // Use a cross hair cursor if shift is pressed
      if (ev.shiftKey) {
        space.container.style.cursor = "url(" + STATIC_URL_JS + "images/svg-circle.cur) 15 15, crosshair";
      } else {
        space.container.style.cursor = 'pointer';
      }
    };

    this.MouseUp = function(ev) {
      var mouse = this.CATMAID_view.mouse,
          controls = this.CATMAID_view.controls,
          space = this.CATMAID_view.space;
      if (space.options.lock_view) return;
      mouse.is_mouse_down = false;
      controls.enabled = true;
      space.render(); // May need another render on occasions
    };

    this.MouseDown = function(ev) {
      var mouse = this.CATMAID_view.mouse,
          space = this.CATMAID_view.space,
          camera = this.CATMAID_view.camera,
          projector = this.CATMAID_view.projector;
      if (!space.options.lock_view) {
        mouse.is_mouse_down = true;
      }
      if (!ev.shiftKey) return;

      // Try to pick a node using a color map. This option is more precise, but
      // also slower than casting a ray, which is not used anymore because
      // buffer geometries don't support it.
      var nodeId = space.pickNodeWithColorMap(ev.offsetX, ev.offsetY, camera);
      if (!nodeId) {
        CATMAID.msg("Oops", "Couldn't find any intersectable object under the mouse.");
      } else {
        SkeletonAnnotations.staticMoveToAndSelectNode(nodeId);
      }
    };
  };

  /**
   * Tries to pick an element by creating a color map.
   *
   * @param x First mouse position component, relativ to WebGL canvas
   * @param y First mouse position component, relativ to WebGL canvas
   * @param camera The camera the picking map should be created with
   * @param savePickingMap Export the picking color map as PNG image
   * @return the picked node's ID or null if no node was found
   */
  WebGLApplication.prototype.Space.prototype.pickNodeWithColorMap =
      function(x, y, camera, savePickingMap) {
    // Attempt to intersect visible skeleton spheres, stopping at the first found
    var color = 0;
    var idMap = {};
    var submit = new submitterFn();
    var originalMaterials = new Map();
    var originalVisibility = {};
    var originalConnectorPreVisibility =
      this.staticContent.connectorLineColors.presynaptic_to.visible;
    var originalConnectorPostVisibility =
      this.staticContent.connectorLineColors.postsynaptic_to.visible;

    // Hide everthing unpickable
    var o = CATMAID.tools.deepCopy(this.options);
    o.show_meshes = false;
    o.show_missing_sections = false;
    o.show_active_node = false;
    o.show_floor = false;
    o.show_background = false;
    o.show_box = false;
    o.show_zplane = false;
    this.staticContent.adjust(o, this);
    this.content.adjust(o, this, submit);
    // Hide pre and post synaptic flags
    this.staticContent.connectorLineColors.presynaptic_to.visible = false;
    this.staticContent.connectorLineColors.postsynaptic_to.visible = false;

    // Disable lighting and add plain ambient light
    var lightVisMap = this.lights.map(function(l) {
      var visible = l.visible;
      l.visible = false;
      return visible;
    });

    var ambientLight = new THREE.AmbientLight(0xffffff);
    this.scene.add(ambientLight);

    // Prepare all spheres for picking by coloring them with an ID.
    mapToPickables(this, this.content.skeletons, function(skeleton) {
      originalVisibility[skeleton.id] = skeleton.actor.neurite.visible;
      skeleton.actor.neurite.visible = false;
    }, function(id, obj, isBuffer) {
      // IDs are expected to be 64 (bigint in Postgres) and can't be mapped to
      // colors directly. Since the space we are looking here at is likely to be
      // smaller, we can map colors to IDs ourself.
      color++;
      idMap[color] = id;
      if (isBuffer) {
        originalMaterials.set(obj, [obj.color, obj.alpha]);
        obj.color = new THREE.Color(color);
        obj.alpha = 1.0;
      } else {
        originalMaterials.set(obj, obj.material);
        obj.material = new THREE.MeshBasicMaterial({color: color});
      }
    });

    // Render scene to picking texture
    var gl = this.view.renderer.getContext();
    this.view.renderer.render(this.scene, camera, this.pickingTexture);
    var pixelBuffer = new Uint8Array(4);

    // Read pixel under cursor
    gl.readPixels(x, this.pickingTexture.height - y, 1, 1, gl.RGBA,
        gl.UNSIGNED_BYTE, pixelBuffer);

    // Reset materials
    mapToPickables(this, this.content.skeletons, function(skeleton) {
      skeleton.actor.neurite.visible = originalVisibility[skeleton.id];
    }, function(id, obj, isBuffer) {
      if (isBuffer) {
        var material = originalMaterials.get(obj);
        obj.color = material[0];
        obj.alpha = material[1];
      } else {
        obj.material = originalMaterials.get(obj);
      }
    });

    // Reset lighting, assuming no change in position
    this.scene.remove(ambientLight);
    this.lights.forEach(function(l, i) {
      l.visible = this[i];
    }, lightVisMap);

    // Reset visibility of unpickable things
    this.staticContent.adjust(this.options, this);
    this.content.adjust(this.options, this, submit);
    // Restore original pre and post synaptic visibility
    this.staticContent.connectorLineColors.presynaptic_to.visible =
      originalConnectorPreVisibility;
    this.staticContent.connectorLineColors.postsynaptic_to.visible =
      originalConnectorPostVisibility;

    var colorId = (pixelBuffer[0] << 16) | (pixelBuffer[1] << 8) | (pixelBuffer[2]);

    // If wanted, the picking map can be exported
    if (savePickingMap) {
      var img = CATMAID.tools.createImageFromGlContext(gl,
          this.pickingTexture.width, this.pickingTexture.height);
      var blob = CATMAID.tools.dataURItoBlob(img.src);
      saveAs(blob, "pickingmap.png");
    }

    if (0 === colorId || !idMap[colorId]) {
      return null;
    }

    return idMap[colorId];

    /**
     * Execute a function for every skeleton and one for each of its pickable
     * elements (defined in fields.
     */
    function mapToPickables(space, skeletons, fnSkeleton, fnPickable) {
      var fields = ['radiusVolumes'];
      Object.keys(skeletons).forEach(function(skeleton_id) {
        var skeleton = skeletons[skeleton_id];
        fnSkeleton(skeleton);
        // Regular mesh fields
        fields.map(function(field) {
          return skeleton[field];
        }).forEach(function(spheres) {
          Object.keys(spheres).forEach(function(id) {
            fnPickable(id, spheres[id], false);
          });
        });
        // Buffer geometry
        var connectorSpheres = skeleton['synapticSpheres'];
        for (var id in connectorSpheres) {
          fnPickable(id, connectorSpheres[id], true);
        }
        var tagSpheres = skeleton['specialTagSpheres'];
        for (var id in tagSpheres) {
          fnPickable(id, tagSpheres[id], true);
        }
      });

    }
  };

  WebGLApplication.prototype.Space.prototype.pickNodeWithIntersectionRay = function(x, y, xOffset, camera) {
    // Attempt to intersect visible skeleton spheres, stopping at the first found
    var fields = ['radiusVolumes'];
    var skeletons = this.content.skeletons;

    // Step, which is normalized screen coordinates, is choosen so that it will
    // span half a pixel width in screen space.
    var adjPxNSC = ((xOffset + 1) / this.canvasWidth) * 2 - 1;
    var step = 0.5 * Math.abs(x - adjPxNSC);
    var increments = 1;

    // Setup ray caster
    var raycaster = new THREE.Raycaster();
    var setupRay = (function(raycaster, camera) {
      if (camera.inPerspectiveMode) {
        raycaster.ray.origin.copy(camera.position);
        //raycaster.ray.origin.set(0, 0, 0).unproject(camera);
        return function(x,y) {
          raycaster.ray.direction.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
        };
      } else {
        raycaster.ray.direction.set(0, 0, -1).transformDirection(camera.matrixWorld);
        return function(x, y) {
          raycaster.ray.origin.set(x, y, -1 ).unproject(camera);
        };
      }
    })(raycaster, camera);

    // Iterate over all skeletons and find the ones that are intersected
    var nodeId = null;
    var intersectionFound = Object.keys(skeletons).some(function(skeleton_id) {
      var skeleton = skeletons[skeleton_id];
      if (!skeleton.visible) return false;
      var all_spheres = fields.map(function(field) { return skeleton[field]; })
                              .reduce(function(a, spheres) {
                                return Object.keys(spheres).reduce(function(a, id) {
                                  a.push(spheres[id]);
                                  return a;
                                }, a);
                              }, []);
      nodeId = intersect(all_spheres, x, y, step, increments, raycaster, setupRay);
      return nodeId !== null;
    });

    return nodeId;

    /**
     * Returns if a ray shot through X/Y (in normalized screen coordinates
     * [-1,1]) inersects at least one of the intersectable spheres. If no
     * intersection is found for the click position, concentric circles are
     * created and rays are shoot along it. These circles are enlarged in every
     * iteration by <step> until a maximum of <increment> circles was tested or
     * an intersection was found. Every two circles, the radius is enlarged by
     * one screen space pixel.
     */
    function intersect(objects, x, y, step, increments, raycaster, setupRay)
    {
      var found = false;
      var nodeId = null;
      for (var i=0; i<=increments; ++i) {
        var numRays = i ? 4 * i : 1;
        var a = 2 * Math.PI / numRays;
        for (var j=0; j<numRays; ++j) {
          setupRay(x + i * step * Math.cos(j * a),
                   y + i * step * Math.sin(j * a));

          // Test intersection
          var intersects = raycaster.intersectObjects(objects);
          if (intersects.length > 0) {
            found = objects.some(function(sphere) {
              if (sphere.id !== intersects[0].object.id) return false;
              nodeId = sphere.node_id;
              return true;
            });
          }

          if (found) {
            break;
          }
        }
        if (found) {
          break;
        }
      }

      return nodeId;
    }
  };

  WebGLApplication.prototype.Space.prototype.Content.prototype.ActiveNode = function(options) {
    this.skeleton_id = null;
    this.mesh = new THREE.Mesh( new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial( { color: 0x00ff00, opacity:0.8, transparent:true } ) );
    CATMAID.tools.setXYZ(this.mesh.scale, options.skeleton_node_scaling);
  };

  WebGLApplication.prototype.Space.prototype.Content.prototype.ActiveNode.prototype = {};

  WebGLApplication.prototype.Space.prototype.Content.prototype.ActiveNode.prototype.setVisible = function(visible) {
    this.mesh.visible = visible ? true : false;
  };

  WebGLApplication.prototype.Space.prototype.Content.prototype.ActiveNode.prototype.updatePosition = function(space, options) {
    var pos = SkeletonAnnotations.getActiveNodePositionW();
    if (!pos) {
      space.updateSplitShading(this.skeleton_id, null, options);
      this.skeleton_id = null;
      return;
    }

    var skeleton_id = SkeletonAnnotations.getActiveSkeletonId();
    space.updateSplitShading(this.skeleton_id, skeleton_id, options);
    this.skeleton_id = skeleton_id;

    this.mesh.position.set(pos.x, pos.y, pos.z);

    var overlay = SkeletonAnnotations.getTracingOverlay(SkeletonAnnotations.getActiveStackViewerId());
    var radius = overlay.nodes[SkeletonAnnotations.getActiveNodeId()].radius;
    CATMAID.tools.setXYZ(this.mesh.scale, radius > 0 ? radius : 40 * options.skeleton_node_scaling);
  };

  WebGLApplication.prototype.Space.prototype.updateSkeleton = function(skeletonmodel, json, options) {
    if (!this.content.skeletons.hasOwnProperty(skeletonmodel.id)) {
      this.content.skeletons[skeletonmodel.id] = new this.Skeleton(this, skeletonmodel);
    }
    this.content.skeletons[skeletonmodel.id].reinit_actor(skeletonmodel, json, options);
    return this.content.skeletons[skeletonmodel.id];
  };

  /** An object to represent a skeleton in the WebGL space.
   *  The skeleton consists of three geometries:
   *    (1) one for the edges between nodes, represented as a list of contiguous pairs of points;
   *    (2) one for the edges representing presynaptic relations to connectors;
   *    (3) one for the edges representing postsynaptic relations to connectors.
   *  Each geometry has its own mesh material and can be switched independently.
   *  In addition, each skeleton node with a pre- or postsynaptic relation to a connector
   *  gets a clickable sphere to represent it.
   *  Nodes matching a custom tag filter or with an 'uncertain' or 'todo' in their
   *  text tags also get a sphere.
   *
   *  When visualizing only the connectors among the skeletons visible in the WebGL space, the geometries of the pre- and postsynaptic edges are hidden away, and a new pair of geometries are created to represent just the edges that converge onto connectors also related to by the other skeletons.
   *
   */
  WebGLApplication.prototype.Space.prototype.Skeleton = function(space, skeletonmodel) {
    // TODO id, baseName, actorColor are all redundant with the skeletonmodel
    this.space = space;
    this.id = skeletonmodel.id;
    this.baseName = skeletonmodel.baseName;
    this.synapticColors = space.staticContent.synapticColors;
    this.skeletonmodel = skeletonmodel;
    this.opacity = skeletonmodel.opacity;
    // This is an index mapping treenode IDs to lists of [reviewer_id, review_time].
    // Attaching them directly to the nodes is too much of a performance hit.
    // Gets loaded dynamically, and erased when refreshing (because a new Skeleton is instantiated with the same model).
    this.reviews = null;
    // The arbor of the axon, as computed by splitByFlowCentrality. Loaded dynamically, and erased when refreshing like this.reviews.
    this.axon = null;
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype = {};

  // Find better way to define connector types
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.CTYPES = ['neurite', 'presynaptic_to', 'postsynaptic_to', 'gapjunction_with'];
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.synapticTypes = ['presynaptic_to', 'postsynaptic_to', 'gapjunction_with'];

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.initialize_objects = function(options) {
    this.visible = true;
    if (undefined === this.skeletonmodel) {
      console.log('Can not initialize skeleton object');
      return;
    }
    this.actorColor = this.skeletonmodel.color.clone();
    var CTYPES = this.CTYPES;
    this.line_material = new THREE.LineBasicMaterial({color: 0xffff00, opacity: 1.0, linewidth: options.skeleton_line_width});

    // Connector links
    this.geometry = {};
    this.geometry[CTYPES[0]] = new THREE.Geometry();
    this.geometry[CTYPES[1]] = new THREE.Geometry();
    this.geometry[CTYPES[2]] = new THREE.Geometry();
    this.geometry[CTYPES[3]] = new THREE.Geometry();

    this.actor = {}; // has three keys (the CTYPES), each key contains the edges of each type
    this.actor[CTYPES[0]] = new THREE.LineSegments(this.geometry[CTYPES[0]], this.line_material);
    this.actor[CTYPES[1]] = new THREE.LineSegments(this.geometry[CTYPES[1]], this.space.staticContent.connectorLineColors[CTYPES[1]]);
    this.actor[CTYPES[2]] = new THREE.LineSegments(this.geometry[CTYPES[2]], this.space.staticContent.connectorLineColors[CTYPES[2]]);
    this.actor[CTYPES[3]] = new THREE.LineSegments(this.geometry[CTYPES[3]], this.space.staticContent.connectorLineColors[CTYPES[3]]);

    this.specialTagSpheres = {};
    this.synapticSpheres = {};
    this.radiusVolumes = {}; // contains spheres and cylinders
    this.textlabels = {};

    // Used only with restricted connectors
    this.connectoractor = null;
    this.connectorgeometry = {};
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.destroy = function(collection) {
    this.removeActorFromScene(collection);
    [this.actor, this.geometry, this.connectorgeometry, this.connectoractor,
     this.specialTagSpheres, this.synapticSpheres,
     this.radiusVolumes, this.textlabels].forEach(function(ob) {
       if (ob) {
         for (var key in ob) {
          if (ob.hasOwnProperty(key)) delete ob[key];
         }
       }
    });
  };

  /**
   * Dispose the skeleton's geometry and material, the connector geometry
   * (connector material is shared) and remove all actor and spehere meshes from
   * the scene. If @collection is given it is expected to be an array and meshes
   * won't be removed, but added to it. It is then the responsibiliy of the
   * caller to remove the objects from the scene.
   *
   * @param collection Optional array to collect meshes to be removed
   */
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.removeActorFromScene = function(collection) {
    // Dispose of both geometry and material, unique to this Skeleton
    this.actor[this.CTYPES[0]].geometry.dispose();
    this.actor[this.CTYPES[0]].material.dispose();

    // Dispose only of the geometries. Materials for connectors are shared
    this.actor[this.CTYPES[1]].geometry.dispose();
    this.actor[this.CTYPES[2]].geometry.dispose();
    this.actor[this.CTYPES[3]].geometry.dispose();

    var meshes = collection || [];
    [this.actor, this.radiusVolumes].forEach(function(ob) {
      if (ob) {
        for (var key in ob) {
          if (ob.hasOwnProperty(key)) this.push(ob[key]);
        }
      }
    }, meshes);

    if (this.connectorSphereCollection) {
      this.connectorSphereCollection.geometry.dispose();
      this.connectorSphereCollection.geometry = null;
      this.connectorSphereCollection.material.dispose();
      this.connectorSphereCollection.material = null;
      meshes.push(this.connectorSphereCollection);
    }

    if (this.specialTagSphereCollection) {
      this.specialTagSphereCollection.geometry.dispose();
      this.specialTagSphereCollection.geometry = null;
      this.specialTagSphereCollection.material.dispose();
      this.specialTagSphereCollection.material = null;
      meshes.push(this.specialTagSphereCollection);
    }

    // If no collection was given, remove objects right away
    if (!collection) {
      this.space.removeAll(meshes);
    }

    this.remove_connector_selection();
    this.removeTextMeshes();
  };

  /** Set the visibility of the skeleton, radius spheres and label spheres. Does not set the visibility of the synaptic spheres or edges. */
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.setActorVisibility = function(vis) {
    this.visible = vis;
    this.visibilityCompositeActor('neurite', vis);

    // radiusVolumes: the spheres where nodes have a radius larger than zero
    // specialTagSpheres: the spheres at special tags like 'TODO', 'Uncertain end', etc.
    [this.radiusVolumes, this.specialTagSpheres].forEach(function(ob) {
      for (var idx in ob) {
        if (ob.hasOwnProperty(idx)) ob[idx].visible = vis;
      }
    });
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.setSynapticVisibilityFn = function(type) {
    return function(vis) {
      this.visibilityCompositeActor(type, vis);
      for (var idx in this.synapticSpheres) {
        if (this.synapticSpheres.hasOwnProperty(idx)
         && this.synapticSpheres[idx].type === type) {
          this.synapticSpheres[idx].visible = vis;
        }
      }
    };
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.setPreVisibility = WebGLApplication.prototype.Space.prototype.Skeleton.prototype.setSynapticVisibilityFn('presynaptic_to');

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.setPostVisibility = WebGLApplication.prototype.Space.prototype.Skeleton.prototype.setSynapticVisibilityFn('postsynaptic_to');

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.setMetaVisibility = function(vis) {
    for (var idx in this.specialTagSpheres) {
      if (this.specialTagSpheres.hasOwnProperty(idx)) {
        this.specialTagSpheres[idx].visible = vis;
      }
    }
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.createTextMeshes = function() {
    // Sort out tags by node: some nodes may have more than one
    var nodeIDTags = {};
    for (var tag in this.tags) {
      if (this.tags.hasOwnProperty(tag)) {
        this.tags[tag].forEach(function(nodeID) {
          if (nodeIDTags.hasOwnProperty(nodeID)) {
            nodeIDTags[nodeID].push(tag);
          } else {
            nodeIDTags[nodeID] = [tag];
          }
        });
      }
    }

    // Sort and convert to string the array of tags of each node
    for (var nodeID in nodeIDTags) {
      if (nodeIDTags.hasOwnProperty(nodeID)) {
        nodeIDTags[nodeID] = nodeIDTags[nodeID].sort().join();
      }
    }

    // Group nodes by common tag string
    var tagNodes = {};
    for (var nodeID in nodeIDTags) {
      if (nodeIDTags.hasOwnProperty(nodeID)) {
        var tagString = nodeIDTags[nodeID];
        if (tagNodes.hasOwnProperty(tagString)) {
          tagNodes[tagString].push(nodeID);
        } else {
          tagNodes[tagString] = [nodeID];
        }
      }
    }

    // Find Vector3 of tagged nodes
    var vs = this.geometry['neurite'].vertices.reduce(function(o, v) {
      if (v.node_id in nodeIDTags) o[v.node_id] = v;
      return o;
    }, {});

    // Create meshes for the tags for all nodes that need them, reusing the geometries
    var cache = this.space.staticContent.textGeometryCache,
        textMaterial = this.space.staticContent.textMaterial;

    var addNode = function(nodeID, text) {
      var v = vs[nodeID];
      text.position.x = v.x;
      text.position.y = v.y;
      text.position.z = v.z;
      this.textlabels[nodeID] = text;
      this.space.add(text);
    };

    for (var tagString in tagNodes) {
      if (tagNodes.hasOwnProperty(tagString)) {
        tagNodes[tagString].forEach(function(nodeID) {
          cache.createTextMesh(tagString, textMaterial,
              addNode.bind(this, nodeID));
        }, this);
      }
    }
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.removeTextMeshes = function() {
    var cache = this.space.staticContent.textGeometryCache;
    for (var k in this.textlabels) {
      if (this.textlabels.hasOwnProperty(k)) {
        this.space.remove(this.textlabels[k]);
        cache.releaseTagGeometry(this.textlabels[k].tagString);
        delete this.textlabels[k];
      }
    }
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.setTextVisibility = function( vis ) {
    // Create text meshes if not there, or destroy them if to be hidden
    if (vis && 0 === Object.keys(this.textlabels).length) {
      this.createTextMeshes();
    } else if (!vis) {
      this.removeTextMeshes();
    }
  };

  /* Unused
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.translate = function( dx, dy, dz ) {
    for ( var i=0; i<CTYPES.length; ++i ) {
      if( dx ) {
        this.actor[CTYPES[i]].translateX( dx );
      }
      if( dy ) {
        this.actor[CTYPES[i]].translateY( dy );
      }
      if( dz ) {
        this.actor[CTYPES[i]].translateZ( dz );
      }
    }
  };
  */

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.createSynapseCounts = function() {
    return this.synapticTypes.reduce((function(o, type, k) {
      var vs = this.geometry[type].vertices;
      for (var i=0, l=vs.length; i<l; i+=2) {
        var treenode_id = vs[i+1].node_id,
            count = o[treenode_id];
        if (count) o[treenode_id] = count + 1;
        else o[treenode_id] = 1;
      }
      return o;
    }).bind(this), {});
  };

  /** Return a map with 4 elements:
   * {presynaptic_to: {}, // map of node ID vs count of presynaptic sites
   *  postsynaptic_to: {}, // map of node ID vs count of postsynaptic sites
   *  presynaptic_to_count: N,
   *  postsynaptic_to_count: M} */
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.createPrePostCounts = function() {
    return this.synapticTypes.reduce((function(o, type, k) {
      var vs = this.geometry[type].vertices,
          syn = {};
      for (var i=0, l=vs.length; i<l; i+=2) {
        var treenode_id = vs[i+1].node_id,
            count = syn[treenode_id];
        if (count) syn[treenode_id] = count + 1;
        else syn[treenode_id] = 1;
      }
      o[type] = syn;
      o[type + "_count"] = vs.length / 2;
      return o;
    }).bind(this), {});
  };

  /** Returns a map of treenode ID keys and lists of {type, connectorID} as values,
   * where type 0 is presynaptic and type 1 is postsynaptic. */
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.createSynapseMap = function() {
    return this.synapticTypes.reduce((function(o, type, k) {
      var vs = this.geometry[type].vertices;
      for (var i=0, l=vs.length; i<l; i+=2) {
        var connector_id = vs[i].node_id,
            treenode_id = vs[i+1].node_id,
            list = o[treenode_id],
            synapse = {type: k,
                       connector_id: connector_id};
        if (list) list.push(synapse);
        else o[treenode_id] = [synapse];
      }
      return o;
    }).bind(this), {});
  };

  /** Returns a map of connector ID keys and a list of treenode ID values.
   */
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.createInverseSynapseMap = function() {
    return this.synapticTypes.reduce((function(o, type) {
      var vs = this.geometry[type].vertices;
      for (var i=0, l=vs.length; i<l; i+=2) {
        var connector_id = vs[i].node_id,
            treenode_id = vs[i+1].node_id,
            list = o[connector_id];
        if (list) {
          list.push(connector_id);
        } else {
          o[connector_id] = [treenode_id];
        }
      }
      return o;
    }).bind(this), {});
  };

  /** Return a map of node ID vs map of tag vs true. */
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.createTagMap = function() {
    var map = {};
    Object.keys(this.tags).forEach(function(tag) {
      this.tags[tag].forEach(function(node) {
        var o = map[node];
        if (o) o[tag] = true;
        else {
          o = {};
          o[tag] = true;
          map[node] = o;
        }
      }, this);
    }, this);
    return map;
  };

  /** For skeletons with a single node will return an Arbor without edges and with a null root,
   * given that it has no edges, and therefore no vertices, at all. */
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.createArbor = function() {
    return new Arbor().addEdges(this.geometry['neurite'].vertices,
                                function(v) { return v.node_id; });
  };

  /** Second argument 'arbor' is optional. */
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.createUpstreamArbor = function(tag_regex, arbor) {
    var tags = this.tags,
        regex = new RegExp(tag_regex),
        cuts = Object.keys(tags).filter(function(tag) {
      return tag.match(regex);
    }).reduce(function(o, tag) {
      return tags[tag].reduce(function(o, nodeID) { o[nodeID] = true; return o;}, o);
    }, {});
    arbor = arbor ? arbor : this.createArbor();
    return arbor.upstreamArbor(cuts);
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.getPositions = function() {
    var vs = this.geometry['neurite'].vertices,
        p = {};
    for (var i=0; i<vs.length; ++i) {
      var v = vs[i];
      p[v.node_id] = v;
    }
    return p;
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.createNodeDistanceFn = function() {
   return (function(child, paren) {
     return this[child].distanceTo(this[paren]);
   }).bind(this.getPositions());
  };

  /** Determine the nodes that belong to the axon by computing the centrifugal flow
   * centrality.
   * Takes as argument the json of compact-arbor, but uses only index 1: the inputs and outputs, parseable by the ArborParser.synapse function.
   * If only one node has the soma tag and it is not the root, will reroot at it.
   * Returns a map of node ID vs true for nodes that belong to the axon.
   * When the flowCentrality cannot be computed, returns null. */
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.splitByFlowCentrality = function(json) {
      var arbor = this.createArbor();

      if (this.tags && this.tags['soma'] && 1 === this.tags['soma'].length) {
        var soma = this.tags['soma'][0];
        if (arbor.root != soma) arbor.reroot(soma);
      }

      var ap = new CATMAID.ArborParser();
      ap.arbor = arbor;
      ap.synapses(json[1]);

      return SynapseClustering.prototype.findAxon(ap, 0.9, this.getPositions());
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.updateSkeletonColor = function(options) {
    var node_weights,
        arbor;
    if ('near_active_node_z_camera' !== options.shading_method &&
        'near_active_node_z_project' !== options.shading_method &&
        this.line_material instanceof CATMAID.ShaderLineBasicMaterial) {
      this.line_material = this.actor.neurite.material = new THREE.LineBasicMaterial({
        color: this.line_material.color,
        opacity: this.line_material.opacity,
        linewidth: options.skeleton_line_width});
    }

    if ('none' === options.shading_method) {
      node_weights = null;
    } else {
      arbor = this.createArbor();

      if (-1 !== options.shading_method.lastIndexOf('centrality')) {
        // Darken the skeleton based on the betweenness calculation.
        var c;
        if (0 === options.shading_method.indexOf('betweenness')) {
          c = arbor.betweennessCentrality(true);
        } else if (0 === options.shading_method.indexOf('slab')) {
          c = arbor.slabCentrality(true); // branch centrality
        } else {
          // Flow centrality
          var io = this.createPrePostCounts();
          if (0 === io.postsynaptic_to_count || 0 === io.presynaptic_to_count) {
            CATMAID.warn('Neuron "' + this.skeletonmodel.baseName + '" lacks input or output synapses.');
            c = arbor.nodesArray().reduce(function(o, node) {
              // All the same
              o[node] = 1;
              return o;
            }, {});
          } else {
            var key = 'sum';
            if (0 === options.shading_method.indexOf('centrifugal')) {
              key = 'centrifugal';
            } else if (0 === options.shading_method.indexOf('centripetal')) {
              key = 'centripetal';
            }
            var fc = arbor.flowCentrality(io.presynaptic_to, io.postsynaptic_to, io.presynaptic_to_count, io.postsynaptic_to_count),
                c = {},
                nodes = Object.keys(fc);
            for (var i=0; i<nodes.length; ++i) {
              var node = nodes[i];
              c[node] = fc[node][key];
            }
          }
        }

        var node_ids = Object.keys(c),
            max = node_ids.reduce(function(a, node_id) {
              return Math.max(a, c[node_id]);
            }, 0);

        // Normalize c in place
        node_ids.forEach(function(node_id) {
          c[node_id] = c[node_id] / max;
        });

        node_weights = c;

      } else if ('distance_to_root' === options.shading_method) {
        var dr = arbor.nodesDistanceTo(arbor.root, this.createNodeDistanceFn()),
            distances = dr.distances,
            max = dr.max;

        // Normalize by max in place
        Object.keys(distances).forEach(function(node) {
          distances[node] = 1 - (distances[node] / max);
        });

        node_weights = distances;

      } else if ('downstream_amount' === options.shading_method) {
        node_weights = arbor.downstreamAmount(this.createNodeDistanceFn(), true);

      } else if ('active_node_split' === options.shading_method) {
        // The active node is not necessarily a real node and splitting the arbor
        // will therefore not work in case of a virtual node. The split is
        // therefore performed with the next real child node and the node weight
        // of the child will be adjusted to get the same visual effect.
        var atn = SkeletonAnnotations.getActiveNodeId();
        var virtualAtn = !SkeletonAnnotations.isRealNode(atn);
        if (virtualAtn) atn = SkeletonAnnotations.getChildOfVirtualNode(atn);
        if (arbor.contains(atn)) {
          node_weights = {};
          var sub = arbor.subArbor(atn),
              up = 1,
              down = 0.5;
          if (options.invert_shading) {
            up = 0.5;
            down = 0;
          }
          arbor.nodesArray().forEach(function(node) {
            node_weights[node] = sub.contains(node) ? down : up;
          });
          if (virtualAtn) {
            // If the active node is virtual, the weight of its real child is
            // adjusted so so that it matches the visual appearance of having an
            // actual node at the ATNs location.
            var vnPos = SkeletonAnnotations.getActiveNodePositionW();
            vnPos = new THREE.Vector3(vnPos.x, vnPos.y, vnPos.z);
            var locations = this.getPositions();
            var vn = SkeletonAnnotations.getActiveNodeId();
            var parentPos = locations[SkeletonAnnotations.getParentOfVirtualNode(vn)];
            var childPos = locations[SkeletonAnnotations.getChildOfVirtualNode(vn)];
            var distRatio = parentPos.distanceToSquared(vnPos) / parentPos.distanceToSquared(childPos);
            node_weights[atn] = up - distRatio * (up - down);
          }
        } else {
          // Don't shade any
          node_weights = {};
        }

      } else if ('partitions' === options.shading_method) {
        // Shade by euclidian length, relative to the longest branch
        var locations = this.getPositions();
        var partitions = arbor.partitionSorted();
        node_weights = partitions.reduce(function(o, seq, i) {
          var loc1 = locations[seq[0]],
              loc2,
              plen = 0;
          for (var i=1, len=seq.length; i<len; ++i) {
            loc2 = locations[seq[i]];
            plen += loc1.distanceTo(loc2);
            loc1 = loc2;
          }
          return seq.reduce(function(o, node) {
            o[node] = plen;
            return o;
          }, o);
        }, {});
        // Normalize by the length of the longest partition, which ends at root
        var max_length = node_weights[arbor.root];
        Object.keys(node_weights).forEach(function(node) {
          node_weights[node] /= max_length;
        });

      } else if (-1 !== options.shading_method.indexOf('strahler')) {
        node_weights = arbor.strahlerAnalysis();
        var max = node_weights[arbor.root];
        Object.keys(node_weights).forEach(function(node) {
          node_weights[node] /= max;
        });
      } else if ('near_active_node' === options.shading_method) {
        var active = SkeletonAnnotations.getActiveNodeId();
        if (!active || !arbor.contains(active)) node_weights = null;
        else {
          var within = arbor.findNodesWithin(active, this.createNodeDistanceFn(), options.distance_to_active_node);
          node_weights = {};
          arbor.nodesArray().forEach(function(node) {
            node_weights[node] = undefined === within[node] ? 0 : 1;
          });
        }

      } else if ('near_active_node_z_camera' === options.shading_method ||
                 'near_active_node_z_project' === options.shading_method) {
        this.line_material = this.actor.neurite.material =
            new CATMAID.ShaderLineBasicMaterial(this.line_material);

        // Determine active node distance in the vertex shader and pass to the
        // fragment shader as a varying.
        this.line_material.insertSnippet(
            'vertexDeclarations',
            'uniform vec3 u_activeNodePosition;\n' +
            'uniform float u_horizon;\n' +
            'varying float activeNodeDistanceDarkening;\n');
        this.line_material.insertSnippet(
            'vertexPosition',
            ('near_active_node_z_camera' === options.shading_method ?
              'vec3 camVert = (vec4(position, 1.0) * modelMatrix).xyz - cameraPosition;\n' +
              'vec3 camAtn = (vec4(u_activeNodePosition, 1.0) * modelMatrix).xyz - cameraPosition;\n' +
              'float zDist = distance(dot(camVert, normalize(camAtn)), length(camAtn));\n' :
              'float zDist = distance(position.z, u_activeNodePosition.z);\n') +
            'activeNodeDistanceDarkening = 1.0 - clamp(zDist/u_horizon, 0.0, 1.0);\n');

        this.line_material.insertSnippet(
            'fragmentDeclarations',
            'varying float activeNodeDistanceDarkening;\n');
        this.line_material.insertSnippet(
            'fragmentColor',
            'gl_FragColor = vec4(outgoingLight * activeNodeDistanceDarkening, diffuseColor.a);\n');

        this.line_material.addUniforms({
            u_activeNodePosition: { type: 'v3', value: SkeletonAnnotations.getActiveNodeProjectVector3() },
            u_horizon: { type: 'f', value: options.distance_to_active_node }});
        this.line_material.refresh();

      } else if ('synapse-free' === options.shading_method) {
        var locations = this.getPositions(),
            node_weights = {};
        arbor.split(this.createSynapseCounts()).forEach(function(fragment) {
          var weight = 0;
          if (fragment.cableLength(locations) >= options.min_synapse_free_cable) {
            weight = 1;
          }
          fragment.nodesArray().forEach(function(node) {
            this[node] = weight;
          }, node_weights);
        });
      } else if ('dendritic-backbone' === options.shading_method) {
        node_weights = {};
        if (!this.axon) {
          // Not computable
          console.log("Shading '" + options.shading_method + "' not computable for skeleton ID #" + this.id + ", neuron named: " + CATMAID.NeuronNameService.getInstance().getName(this.id) + ". The axon is missing.");
        } else {
          // Prune artifactual branches
          if (this.tags['not a branch']) {
            var ap = new CATMAID.ArborParser(); ap.inputs = {}; ap.outputs = {};
            ap.arbor = arbor.clone();
            ap.collapseArtifactualBranches(this.tags);
            arbor = ap.arbor;
          }
          // Create backbone arbor
          var upstream;
          if (this.tags['microtubules end'] && this.tags['microtubules end'].length > 0) {
            upstream = this.createUpstreamArbor('microtubules end', arbor);
          } else {
            var cuts = arbor.approximateTwigRoots(options.strahler_cut);
            if (cuts && cuts.length > 0) {
              upstream = arbor.upstreamArbor(cuts);
              CATMAID.msg("Approximating dendritic backbone", "By strahler number " + options.strahler_cut + ", neuron: " + CATMAID.NeuronNameService.getInstance().getName(this.id));
            }
          }
          node_weights = {};
          if (upstream) {
            // Collect nodes that don't belong to the dendritic backbone
            var outside = {},
                add = (function(node) { this[node] = true; }).bind(outside);
            // Nodes from the axon terminals
            this.axon.nodesArray().forEach(add);
            // Nodes from the linker between dendritic tree and axon terminals
            this.axon.fc_max_plateau.forEach(add);
            // Nodes primarily from the linker between arbor and soma
            this.axon.fc_zeros.forEach(add);
            // Set weights
            arbor.nodesArray().forEach(function(node) {
              this[node] = (upstream.contains(node) && !outside[node]) ? 1 : 0;
            }, node_weights);
          }
        }
      } else if ('downstream-of-tag' === options.shading_method) {
        node_weights = {};
        var upstream = this.createUpstreamArbor(options.tag_regex, arbor);
        arbor.nodesArray().forEach(function(node) {
          this[node] = upstream.contains(node) ? 0 : 1;
        }, node_weights);
      }
    }

    if (options.invert_shading && node_weights) {
      // All weights are values between 0 and 1
      Object.keys(node_weights).forEach(function(node) {
        this[node] = 1 - this[node];
      }, node_weights);
    }

    if (node_weights || 'none' !== options.color_method) {
      // The skeleton colors need to be set per-vertex.
      this.line_material.vertexColors = THREE.VertexColors;
      this.line_material.needsUpdate = true;

      var pickColor;
      var actorColor = this.actorColor;
      var unreviewedColor = new THREE.Color().setRGB(0.2, 0.2, 0.2);
      var reviewedColor = new THREE.Color().setRGB(1.0, 0.0, 1.0);
      var axonColor = new THREE.Color().setRGB(0, 1, 0),
          dendriteColor = new THREE.Color().setRGB(0, 0, 1),
          notComputable = new THREE.Color().setRGB(0.4, 0.4, 0.4);
      if (options.color_method.startsWith('creator')) {
        var userColor;
        if ('creator' === options.color_method) {
          userColor = function (userID) { return CATMAID.User(userID).color; };
        } else if ('creator-relevant' === options.color_method) {
          if (!this.space.userColormap.colorizer) {
            this.space.userColormap.colorizer = {};
            CATMAID.asColorizer(this.space.userColormap.colorizer);
          }
          var colorizer = this.space.userColormap.colorizer;
          userColor = colorizer.pickColor.bind(colorizer);
        }

        pickColor = (function (vertex) {
          var userID = vertex.user_id;
          if (!this.space.userColormap.hasOwnProperty(userID)) {
            this.space.userColormap[userID] = userColor(userID);
          }

          return this.space.userColormap[userID];
        }).bind(this);
      } else if ('all-reviewed' === options.color_method) {
        pickColor = this.reviews ?
          (function(vertex) {
            var reviewers = this.reviews[vertex.node_id];
            return reviewers && reviewers.length > 0 ?
              reviewedColor : unreviewedColor;
          }).bind(this)
          : function() { return notComputable; };
      } else if ('whitelist-reviewed' === options.color_method) {
        pickColor = this.reviews ?
          (function(vertex) {
            var wl = CATMAID.ReviewSystem.Whitelist.getWhitelist();
            var reviewers = this.reviews[vertex.node_id];
          return reviewers && reviewers.some(function (r) {
              return r[0] in wl && (new Date(r[1])) > wl[r[0]];}) ?
            reviewedColor : unreviewedColor;
        }).bind(this)
          : function() { return notComputable; };
      } else if ('own-reviewed' === options.color_method) {
        var userId = CATMAID.session.userid;
        pickColor = this.reviews ?
          (function(vertex) {
            var reviewers = this.reviews[vertex.node_id];
          return reviewers && reviewers.some(function (r) { return r[0] == userId;}) ?
            reviewedColor : unreviewedColor;
        }).bind(this)
          : function() { return notComputable; };
      } else if ('axon-and-dendrite' === options.color_method) {
        pickColor = this.axon ?
          (function(vertex) {
          return this.contains(vertex.node_id) ? axonColor : dendriteColor;
        }).bind(this.axon)
          : function() { return notComputable; };
      } else {
        pickColor = function() { return actorColor; };
      }

      // When not using shading, but using creator or reviewer:
      if (!node_weights) node_weights = {};

      var seen = {};
      this.geometry['neurite'].colors = this.geometry['neurite'].vertices.map(function(vertex) {
        var node_id = vertex.node_id,
            color = seen[node_id];
        if (color) return color;

        var weight = node_weights[node_id];
        weight = undefined === weight? 1.0 : weight * 0.9 + 0.1;

        var baseColor = pickColor(vertex);
        color = new THREE.Color().setRGB(baseColor.r * weight,
                                             baseColor.g * weight,
                                             baseColor.b * weight);

        seen[node_id] = color;

        // Side effect: color a volume at the node, if any
        var mesh = this.radiusVolumes[node_id];
        if (mesh) {
          var material = mesh.material.clone();
          material.color = color;
          mesh.material = material;
        }

        return color;
      }, this);

      this.geometry['neurite'].colorsNeedUpdate = true;
      this.actor['neurite'].material.color = new THREE.Color().setHex(0xffffff);

      if ('none' === options.color_method) {
        this.actor['neurite'].material.opacity = this.opacity;
        this.actor['neurite'].material.transparent = this.opacity !== 1;
      } else {
        this.actor['neurite'].material.opacity = 1;
        this.actor['neurite'].material.transparent = false;
      }

      this.actor['neurite'].material.needsUpdate = true; // TODO repeated, it's the line_material

    } else {
      // Display the entire skeleton with a single color.
      this.geometry['neurite'].colors = [];
      this.line_material.vertexColors = THREE.NoColors;
      this.line_material.needsUpdate = true;

      this.actor['neurite'].material.color = this.actorColor;
      this.actor['neurite'].material.opacity = this.opacity;
      this.actor['neurite'].material.transparent = this.opacity !== 1;
      this.actor['neurite'].material.needsUpdate = true; // TODO repeated it's the line_material


      var Material = getSkeletonMaterialType(options['neuron_material']);
      var material = new Material({color: this.actorColor, opacity: this.opacity, transparent: this.opacity !== 1});

      for (var k in this.radiusVolumes) {
        if (this.radiusVolumes.hasOwnProperty(k)) {
          this.radiusVolumes[k].material = material;
        }
      }
    }

    if (typeof this.line_material.refresh === 'function') this.line_material.refresh();
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.changeSkeletonLineWidth = function(width) {
      this.actor['neurite'].material.linewidth = width;
      this.actor['neurite'].material.needsUpdate = true;
  };

  /**
   * Scale node handles of a skeletons. These are the special tag spheres and the
   * synaptic spheres.
   */
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.scaleNodeHandles = function(value) {
      // Scale special tag spheres
      for (var k in this.specialTagSpheres) {
        // All special tag spheres are stored in one buffer geometry. Iterate
        // over each buffer object, get node location, translate each point of
        // the object to origin and scale.
        if (this.specialTagSpheres.hasOwnProperty(k)) {
          this.specialTagSpheres[k].scale = value;
        }
      }

      // Scale synaptic spheres
      for (var k in this.synapticSpheres) {
        if (this.synapticSpheres.hasOwnProperty(k)) {
          this.synapticSpheres[k].scale = value;
        }
      }
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.changeColor = function(color, options) {
    this.actorColor = color;
    if (options.color_method === 'manual') {
      this.updateSkeletonColor(options);
    }
  };

  WebGLApplication.prototype.updateCameraView = function(toOrthographic) {
    if(toOrthographic) {
      this.options.camera_view = 'orthographic';
      this.space.view.setCameraMode(true);
    } else {
      this.options.camera_view = 'perspective';
      this.space.view.camera.setZoom(1.0);
      this.space.view.setCameraMode(false);
    }
    this.space.render();
  };


  WebGLApplication.prototype.updateConnectorColors = function(select) {
    this.options.connector_color = select.value;
    var skeletons = Object.keys(this.space.content.skeletons).map(function(skid) {
      return this.space.content.skeletons[skid];
    }, this);
    this.space.updateConnectorColors(this.options, skeletons, this.space.render.bind(this.space));
  };

  /**
   * If restriced connector geometry is in use, update their material and color
   * with the color of regular connectors. Only a reference is used.
   */
  WebGLApplication.prototype.Space.prototype.updateRestrictedConnectorColors = function(skeletons) {
    for (var i=0; i < skeletons.length; ++i) {
      var s = skeletons[i];
      // If there is restricted connector geometry displayed, update it, too
      if (s.connectoractor) {
        s.synapticTypes.forEach(function(type) {
          // A reference is fine, the connectoractor material and geometry color
          // aren't modified directly.
          this.connectoractor[type].material = this.actor[type].material;
          this.connectoractor[type].material.needsUpdate = true;
          this.connectorgeometry[type].colors = this.geometry[type].colors;
          this.connectorgeometry[type].colorsNeedUpdate = true;
        }, s);
      }
    }
  };

  WebGLApplication.prototype.Space.prototype.updateConnectorColors = function(options, skeletons, callback) {
    // Make all
    var self = this;
    var done = function() {
      self.updateRestrictedConnectorColors(skeletons);
      if (CATMAID.tools.isFn(callback)) callback();
    };

     if ('cyan-red' === options.connector_color ||
        'cyan-red-dark' === options.connector_color) {
      var pre = this.staticContent.synapticColors[0],
          post = this.staticContent.synapticColors[1];

      pre.color.setRGB(1, 0, 0); // red
      pre.vertexColors = THREE.NoColors;
      pre.needsUpdate = true;

      if ('cyan-red' === options.connector_color) post.color.setRGB(0, 1, 1); // cyan
      else post.color.setHex(0x00b7eb); // dark cyan
      post.vertexColors = THREE.NoColors;
      post.needsUpdate = true;

      skeletons.forEach(function(skeleton) {
        skeleton.completeUpdateConnectorColor(options);
      });

      done();

    } else if ('by-amount' === options.connector_color) {

      var skids = skeletons.map(function(skeleton) { return skeleton.id; });

      if (skids.length > 1) $.blockUI();

      requestQueue.register(django_url + project.id + "/skeleton/connectors-by-partner",
          "POST",
          {skids: skids},
          (function(status, text) {
            try {
              if (200 !== status) return;
              var json = JSON.parse(text);
              if (json.error) return alert(json.error);

              skeletons.forEach(function(skeleton) {
                skeleton.completeUpdateConnectorColor(options, json[skeleton.id]);
              });

              done();
            } catch (e) {
              console.log(e, e.stack);
              alert(e);
            }
            $.unblockUI();
          }).bind(this));
    } else if ('axon-and-dendrite' === options.connector_color || 'synapse-clustering' === options.connector_color) {
      fetchSkeletons(
          skeletons.map(function(skeleton) { return skeleton.id; }),
          function(skid) { return django_url + project.id + '/' + skid + '/0/1/0/compact-arbor'; },
          function(skid) { return {}; },
          (function(skid, json) { this.content.skeletons[skid].completeUpdateConnectorColor(options, json); }).bind(this),
          function(skid) { CATMAID.msg("Error", "Failed to load synapses for: " + skid); },
          (function() {
            done();
            this.render();
          }).bind(this));
    } else if ('skeleton' === options.connector_color) {
      skeletons.forEach(function(skeleton) {
        var fnConnectorValue = function() { return 0; },
            fnMakeColor = function() { return skeleton.skeletonmodel.color.clone(); };
        skeleton.synapticTypes.forEach(function(type) {
          skeleton._colorConnectorsBy(type, fnConnectorValue, fnMakeColor);
        });
      });
      done();
    }
  };

  /** Operates in conjunction with updateConnectorColors above. */
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.completeUpdateConnectorColor = function(options, json) {
    if ('cyan-red' === options.connector_color ||
        'cyan-red-dark' === options.connector_color) {
      this.CTYPES.slice(1).forEach(function(type, i) {
        this.geometry[type].colors = [];
        this.geometry[type].colorsNeedUpdate = true;
        this.actor[type].material.vertexColors = THREE.NoColors;
        this.actor[type].material.color = this.synapticColors[this.CTYPES[1] === type ? 0 : 1].color;
        this.actor[type].material.needsUpdate = true;
      }, this);

      Object.keys(this.synapticSpheres).forEach(function(idx) {
        var bufferObject = this.synapticSpheres[idx];
        // TODO: Handle other connector types
        var meshType = this.CTYPES[1] === bufferObject.type ? 0 : 1;
        bufferObject.setFromMaterial(this.synapticColors[meshType]);
      }, this);

    } else if ('by-amount' === options.connector_color) {
      var ranges = {};
      ranges[this.CTYPES[1]] = function(ratio) {
        return 0.66 + 0.34 * ratio; // 0.66 (blue) to 1 (red)
      };
      ranges[this.CTYPES[2]] = function(ratio) {
        return 0.16 + 0.34 * (1 - ratio); //  0.5 (cyan) to 0.16 (yellow)
      };

      this.CTYPES.slice(1).forEach(function(type) {
        var partners = json[type];
        if (!partners) return;
        var connectors = Object.keys(partners).reduce(function(o, skid) {
              return partners[skid].reduce(function(a, connector_id, i, arr) {
                a[connector_id] = arr.length;
                return a;
              }, o);
            }, {}),
            max = Object.keys(connectors).reduce(function(m, connector_id) {
              return Math.max(m, connectors[connector_id]);
            }, 0),
            range = ranges[type];

        var fnConnectorValue = function(node_id, connector_id) {
          var value = connectors[connector_id];
          if (!value) value = 1; // connector without partner skeleton
          return value;
        };

        var fnMakeColor = function(value) {
          return new THREE.Color().setHSL(1 === max ? range(0) : range((value -1) / (max -1)), 1, 0.5);
        };

        this._colorConnectorsBy(type, fnConnectorValue, fnMakeColor);

      }, this);

    } else if ('synapse-clustering' === options.connector_color) {
      var synapse_map = new CATMAID.ArborParser().synapses(json[1]).createSynapseMap(),
          sc = new SynapseClustering(this.createArbor(), this.getPositions(), synapse_map, options.synapse_clustering_bandwidth),
          density_hill_map = sc.densityHillMap(),
          clusters = sc.clusterMaps(density_hill_map),
          colorizer = d3.scale.category10(),
          synapse_treenodes = Object.keys(sc.synapses);
      // Filter out clusters without synapses
      var clusterIDs = Object.keys(clusters).filter(function(id) {
        var treenodes = clusters[id];
        for (var k=0; k<synapse_treenodes.length; ++k) {
          if (treenodes[synapse_treenodes[k]]) return true;
        }
        return false;
      });
      var cluster_colors = clusterIDs
            .map(function(cid) { return [cid, clusters[cid]]; })
            .sort(function(a, b) {
              var la = a[1].length,
                  lb = b[1].length;
              return la === lb ? 0 : (la > lb ? -1 : 1);
            })
            .reduce(function(o, c, i) {
              o[c[0]] = new THREE.Color().set(colorizer(i));
              return o;
            }, {});

      var fnConnectorValue = function(node_id, connector_id) {
        return density_hill_map[node_id];
      };

      var fnMakeColor = function(value) {
        return cluster_colors[value];
      };

      this.synapticTypes.forEach(function(type) {
        this._colorConnectorsBy(type, fnConnectorValue, fnMakeColor);
      }, this);

    } else if ('axon-and-dendrite' === options.connector_color) {
      var axon = this.axon ? this.axon : null,
          fnMakeColor,
          fnConnectorValue;

      if (axon) {
        var colors = [new THREE.Color().setRGB(0, 1, 0),  // axon: green
                      new THREE.Color().setRGB(0, 0, 1)]; // dendrite: blue
        fnConnectorValue = function(node_id, connector_id) { return axon.contains(node_id) ? 0 : 1; };
        fnMakeColor = function(value) { return colors[value]; };
      } else {
        // Not computable
        fnMakeColor = function() { return new THREE.Color().setRGB(0.4, 0.4, 0.4); };
        fnConnectorValue = function() { return 0; };
      }

      this.synapticTypes.forEach(function(type) {
        this._colorConnectorsBy(type, fnConnectorValue, fnMakeColor);
      }, this);
    }
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype._colorConnectorsBy =
      function(type, fnConnectorValue, fnMakeColor) {
    // Set colors per-vertex
    var seen = {},
        seen_materials = {},
        colors = [],
        vertices = this.geometry[type].vertices;

    for (var i=0; i<vertices.length; i+=2) {
      var connector_id = vertices[i].node_id,
          node_id = vertices[i+1].node_id,
          value = fnConnectorValue(node_id, connector_id);

      var color = seen[value];

      if (!color) {
        color = fnMakeColor(value);
        seen[value] = color;
      }

      // twice: for treenode and for connector
      colors.push(color);
      colors.push(color);

      var bufferObject = this.synapticSpheres[node_id];
      if (bufferObject) {
        bufferObject.color = color;
        // TODO: Might not be needed anymore: why should we store this extra
        // material anyway.
        var material = seen_materials[value];
        if (!material) {
          material = bufferObject.material.clone();
          material.color = color;
          seen_materials[value] = material;
        }
        bufferObject.material = material;
      }
    }

    this.geometry[type].colors = colors;
    this.geometry[type].colorsNeedUpdate = true;
    var material = new THREE.LineBasicMaterial({color: 0xffffff, opacity: 1.0, linewidth: 6});
    material.vertexColors = THREE.VertexColors;
    material.needsUpdate = true;
    this.actor[type].material = material;
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.addCompositeActorToScene = function() {
    this.CTYPES.forEach(function(t) {
      var actor = this.actor[t];
      // Only add geometry to the scene that has at least one vertex. Not every
      // CTYPE actor is actually used, so this case can happen. Adding empty
      // geometry causes renderer warnings, which we want to avoid.
      if (actor && actor.geometry.vertices.length > 0) {
        this.space.add(this.actor[t]);
      }
    }, this);
  };

  /** Three possible types of actors: 'neurite', 'presynaptic_to', and 'postsynaptic_to', each consisting, respectibly, of the edges of the skeleton, the edges of the presynaptic sites and the edges of the postsynaptic sites. */
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.visibilityCompositeActor = function(type, visible) {
    this.actor[type].visible = visible;
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.getActorColorAsHTMLHex = function () {
    return this.actorColor.getHexString();
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.getActorColorAsHex = function() {
    return this.actorColor.getHex();
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.remove_connector_selection = function() {
    if (this.connectoractor) {
      for (var i=0; i<2; ++i) {
        var ca = this.connectoractor[this.synapticTypes[i]];
        if (ca) {
          ca.geometry.dispose(); // do not dispose material, it is shared
          this.space.remove(ca);
          delete this.connectoractor[this.synapticTypes[i]];
        }
      }
      this.connectoractor = null;
    }
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.create_connector_selection = function( common_connector_IDs ) {
    this.connectoractor = {};
    this.connectorgeometry = {};
    this.connectorgeometry[this.CTYPES[1]] = new THREE.Geometry();
    this.connectorgeometry[this.CTYPES[2]] = new THREE.Geometry();
    this.connectorgeometry[this.CTYPES[3]] = new THREE.Geometry();

    this.synapticTypes.forEach(function(type) {
      // Vertices is an array of Vector3, every two a pair, the first at the connector and the second at the node
      var vertices1 = this.geometry[type].vertices;
      var vertices2 = this.connectorgeometry[type].vertices;
      for (var i=vertices1.length-2; i>-1; i-=2) {
        var v = vertices1[i];
        if (common_connector_IDs.hasOwnProperty(v.node_id)) {
          vertices2.push(vertices1[i+1]);
          vertices2.push(v);
        }
      }
      this.connectoractor[type] = new THREE.LineSegments( this.connectorgeometry[type],
          this.actor[type].material );
      this.connectorgeometry[type].colors = this.geometry[type].colors;
      this.connectorgeometry[type].colorsNeedUpdate = true;
      this.space.add( this.connectoractor[type] );
    }, this);
  };

  /**
   * Place a colored sphere at each node. Used for highlighting special tags like
   * 'uncertain end' and 'todo'. Implemented with buffer geometries to gain
   * better performance.
   */
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.createLabelSpheres =
      function(labels, scaling) {

    var geometry = new CATMAID.MultiObjectInstancedBufferGeometry({
      templateGeometry: this.space.staticContent.labelspheregeometry,
      nObjects: labels.length,
      scaling: scaling
    });

    geometry.createAll(labels, scaling, (function(v, m, o) {
      return !this.specialTagSpheres.hasOwnProperty(v.node_id);
    }).bind(this), (function(v, m, o, bufferObject) {
      this.specialTagSpheres[v.node_id] = bufferObject;
    }).bind(this));

    var material = geometry.createLambertMaterial();

    this.specialTagSphereCollection = new THREE.Mesh(geometry, material);
    this.space.add(this.specialTagSphereCollection);
  };

  /**
   * The itype is 0 (pre) or 1 (post), and chooses from the two arrays:
   * synapticTypes and synapticColors.
   */
  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.createPartnerSpheres =
      function(connectors, scaling) {

    var geometry = new CATMAID.MultiObjectInstancedBufferGeometry({
      templateGeometry: this.space.staticContent.radiusSphere,
      nObjects: connectors.length,
      scaling: scaling
    });

    geometry.createAll(connectors, scaling, (function(v, m, o) {
      // There already is a synaptic sphere at the node
      return !this.synapticSpheres.hasOwnProperty(v.node_id);
    }).bind(this), (function(v, m, o, bufferObject) {
      bufferObject.node_id = v.node_id;
      bufferObject.type = this.synapticTypes[o[2]];
      this.synapticSpheres[v.node_id] = bufferObject;
    }).bind(this));

    var material = geometry.createLambertMaterial();

    this.specialTagSphereCollection = new THREE.Mesh(geometry, material);
    this.space.add(this.specialTagSphereCollection);
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.createEdge = function(v1, v2, type) {
    // Create edge between child (id1) and parent (id2) nodes:
    // Takes the coordinates of each node, transforms them into the space,
    // and then adds them to the parallel lists of vertices and vertexIDs
    var vs = this.geometry[type].vertices;
    vs.push(v1, v2);
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.createNodeSphere = function(v, radius, material) {
    if (this.radiusVolumes.hasOwnProperty(v.node_id)) {
      // There already is a sphere or cylinder at the node
      return;
    }
    // Reuse geometry: an icoSphere of radius 1.0
    var mesh = new THREE.Mesh(this.space.staticContent.icoSphere, material);
    // Scale the mesh to bring about the correct radius
    mesh.scale.x = mesh.scale.y = mesh.scale.z = radius;
    mesh.position.set( v.x, v.y, v.z );
    mesh.node_id = v.node_id;
    this.radiusVolumes[v.node_id] = mesh;
    this.space.add(mesh);
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.createCylinder = function(v1, v2, radius, material) {
    if (this.radiusVolumes.hasOwnProperty(v1.node_id)) {
      // There already is a sphere or cylinder at the node
      return;
    }
    var mesh = new THREE.Mesh(this.space.staticContent.cylinder, material);

    // BE CAREFUL with side effects: all functions on a Vector3 alter the vector and return it (rather than returning an altered copy)
    var direction = new THREE.Vector3().subVectors(v2, v1);

    mesh.scale.x = radius;
    mesh.scale.y = direction.length();
    mesh.scale.z = radius;

    var arrow = new THREE.ArrowHelper(direction.clone().normalize(), v1);
    mesh.quaternion.copy(arrow.quaternion);
    mesh.position.addVectors(v1, direction.multiplyScalar(0.5));

    mesh.node_id = v1.node_id;

    this.radiusVolumes[v1.node_id] = mesh;
    this.space.add(mesh);
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.reinit_actor = function(skeletonmodel, json, options) {
    if (this.actor) {
      this.destroy();
    }
    this.skeletonmodel = skeletonmodel;
    this.initialize_objects(options);

    var nodes = json[0];
    var connectors = json[1];
    var tags = json[2];

    var lean = options.lean_mode;

    // Map of node ID vs node properties array
    var nodeProps = nodes.reduce(function(ob, node) {
      ob[node[0]] = node;
      return ob;
    }, {});

    // Store for creation when requested
    // TODO could request them from the server when necessary
    this.tags = tags;

    // Cache for reusing Vector3d instances
    var vs = {};

    // Reused for all meshes
    var Material = getSkeletonMaterialType(options['neuron_material']);
    var material = new Material( { color: this.getActorColorAsHex(), opacity:1.0, transparent:false } );
    material.opacity = this.skeletonmodel.opacity;
    material.transparent = material.opacity !== 1;

    // Collect all labels first, before creating its geometry
    var partner_nodes = [];
    var labels = [];

    // Create edges between all skeleton nodes
    // and a sphere on the node if radius > 0
    nodes.forEach(function(node) {
      // node[0]: treenode ID
      // node[1]: parent ID
      // node[2]: user ID
      // 3,4,5: x,y,z
      // node[6]: radius
      // node[7]: confidence
      // If node has a parent
      var v1;
      if (node[1]) {
        v1 = vs[node[0]];
        if (!v1) {
          v1 = new THREE.Vector3(node[3], node[4], node[5]);
          v1.node_id = node[0];
          v1.user_id = node[2];
          vs[node[0]] = v1;
        }
        var p = nodeProps[node[1]];
        var v2 = vs[p[0]];
        if (!v2) {
          v2 = new THREE.Vector3(p[3], p[4], p[5]);
          v2.node_id = p[0];
          v2.user_id = p[2];
          vs[p[0]] = v2;
        }
        var nodeID = node[0];
        if (node[6] > 0 && p[6] > 0) {
          // Create cylinder using the node's radius only (not the parent) so that the geometry can be reused
          this.createCylinder(v1, v2, node[6], material);
          // Create skeleton line as well
          this.createEdge(v1, v2, 'neurite');
        } else {
          // Create line
          this.createEdge(v1, v2, 'neurite');
          // Create sphere
          if (node[6] > 0) {
            this.createNodeSphere(v1, node[6], material);
          }
        }
      } else {
        // For the root node, which must be added to vs
        v1 = vs[node[0]];
        if (!v1) {
          v1 = new THREE.Vector3(node[3], node[4], node[5]);
          v1.node_id = node[0];
          v1.user_id = node[2];
          vs[node[0]] = v1;
        }
        if (node[6] > 0) {
          // Clear the slot for a sphere at the root
          var mesh = this.radiusVolumes[v1.node_id];
          if (mesh) {
            this.space.remove(mesh);
            delete this.radiusVolumes[v1.node_id];
          }
          this.createNodeSphere(v1, node[6], material);
        }
      }
      if (!lean && node[7] < 5) {
        // Edge with confidence lower than 5
        labels.push([v1, this.space.staticContent.labelColors.uncertain]);
      }
    }, this);

    if (options.smooth_skeletons) {
      var arbor = this.createArbor();
      if (arbor.root) {
        var smoothed = arbor.smoothPositions(vs, options.smooth_skeletons_sigma),
            vertices = this.geometry['neurite'].vertices;
        // Iterate only unique vertices: the children
        for (var i=0; i<vertices.length; i+=2) {
          var v = vertices[i]; // i: child, i+1: parent
          v.copy(smoothed[v.node_id]);
        }
        // Root should not change position, but for completeness and future-proofing:
        vs[arbor.root].copy(smoothed[arbor.root]);
      }
    }

    // Create edges between all connector nodes and their associated skeleton nodes,
    // appropriately colored as pre- or postsynaptic.
    // If not yet there, create as well the sphere for the node related to the connector
    connectors.forEach(function(con) {
      // con[0]: treenode ID
      // con[1]: connector ID
      // con[2]: 0 for pre, 1 for post, 2 for gap junction, -1 for other to be skipped
      // indices 3,4,5 are x,y,z for connector
      // indices 4,5,6 are x,y,z for node
      var type = con[2];
      if (type === -1) return;
      var v1 = new THREE.Vector3(con[3], con[4], con[5]);
      v1.node_id = con[1];
      var v2 = vs[con[0]];
      this.createEdge(v1, v2, this.synapticTypes[type]);
      var defaultMaterial = this.space.staticContent.synapticColors[type] ||
        this.space.staticContent.synapticColors.default;
      partner_nodes.push([v2, defaultMaterial, type]);
    }, this);

    // Place spheres on nodes with special labels, if they don't have a sphere there already
    var customTagRe = new RegExp(options.custom_tag_spheres_regex || 'a^');
    for (var tag in this.tags) {
      if (this.tags.hasOwnProperty(tag)) {
        var tagLC = tag.toLowerCase();
        if (-1 !== tagLC.indexOf('todo')) {
          this.tags[tag].forEach(function(nodeID) {
            if (!this.specialTagSpheres[nodeID]) {
              labels.push([vs[nodeID], this.space.staticContent.labelColors.todo]);
            }
          }, this);
        } else if (-1 !== tagLC.indexOf('uncertain')) {
          this.tags[tag].forEach(function(nodeID) {
            if (!this.specialTagSpheres[nodeID]) {
              labels.push([vs[nodeID], this.space.staticContent.labelColors.uncertain]);
            }
          }, this);
        } else if (customTagRe.test(tagLC)) {
          this.tags[tag].forEach(function(nodeID) {
            if (!this.specialTagSpheres[nodeID]) {
              labels.push([vs[nodeID], this.space.staticContent.labelColors.custom]);
            }
          }, this);
        }
      }
    }

    // Create buffer geometry for connectors
    if (partner_nodes.length > 0) {
      this.createPartnerSpheres(partner_nodes, options.skeleton_node_scaling);
    }

    // Create buffer geometry for labels
    if (labels.length > 0) {
      this.createLabelSpheres(labels, options.skeleton_node_scaling);
    }

    if (options.resample_skeletons) {
      if (options.smooth_skeletons) {
        // Can't both smooth and resample
        return;
      }
      // WARNING: node IDs no longer resemble actual skeleton IDs.
      // All node IDs will now have negative values to avoid accidental similarities.
      var arbor = this.createArbor();
      if (arbor.root) {
        var res = arbor.resampleSlabs(vs, options.smooth_skeletons_sigma, options.resampling_delta, 2);
        var vs = this.geometry['neurite'].vertices;
        // Remove existing lines
        vs.length = 0;
        // Add all new lines
        var edges = res.arbor.edges,
            positions = res.positions;
        Object.keys(edges).forEach(function(nodeID) {
          // Fix up Vector3 instances
          var v_child = positions[nodeID];
          v_child.user_id = -1;
          v_child.node_id = -nodeID;
          // Add line
          vs.push(v_child);
          vs.push(positions[edges[nodeID]]); // parent
        });
        // Fix up root
        var v_root = positions[res.arbor.root];
        v_root.user_id = -1;
        v_root.node_id = -res.arbor.root;
      }
    }
  };

  WebGLApplication.prototype.Space.prototype.Skeleton.prototype.show = function(options) {

    this.addCompositeActorToScene();

    this.setActorVisibility( this.skeletonmodel.selected ); // the skeleton, radius spheres and label spheres

    if (options.connector_filter) {
      this.setPreVisibility( false ); // the presynaptic edges and spheres
      this.setPostVisibility( false ); // the postsynaptic edges and spheres
    } else {
      this.setPreVisibility( this.skeletonmodel.pre_visible ); // the presynaptic edges and spheres
      this.setPostVisibility( this.skeletonmodel.post_visible ); // the postsynaptic edges and spheres
    }

    this.setTextVisibility( this.skeletonmodel.text_visible ); // the text labels
    this.setMetaVisibility( this.skeletonmodel.meta_visible ); // tags

    //this.updateSkeletonColor(options);

    // Will query the server
    if ('cyan-red' !== options.connector_color) this.space.updateConnectorColors(options, [this]);
  };

  /**
   * Toggles the display of a JQuery UI dialog that shows which user has which
   * color assigned.
   */
  WebGLApplication.prototype.toggleUserColormapDialog = function() {
    // In case a color dialog exists already, close it and return.
    if ($('#user-colormap-dialog').length > 0) {
        $('#user-colormap-dialog').remove();
        return;
    }

    // Create a new color dialog
    var dialog = document.createElement('div');
    dialog.setAttribute("id", "user-colormap-dialog");
    dialog.setAttribute("title", "User colormap");

    var tab = document.createElement('table');
    tab.setAttribute("id", "usercolormap-table");
    tab.innerHTML =
        '<thead>' +
          '<tr>' +
            '<th>login</th>' +
            '<th>name</th>' +
            '<th>color</th>' +
          '</tr>' +
        '</thead>' +
        '<tbody></tbody>';
    dialog.appendChild(tab);

    $(dialog).dialog({
      height: 440,
      width: 340,
      modal: false,
      dialogClass: "no-close",
      buttons: {
        "OK": function() {
          $(this).dialog("close");
        }
      },
      close: function(event, ui) {
        $('#user-colormap-dialog').remove();
      }
    });

    var users = CATMAID.User.all();
    users = Object.keys(this.space.userColormap)
        .map(function (userID) { return users[userID]; })
        .filter(function (user) { return !!user && user.id !== "-1"; })
        .sort(CATMAID.User.displayNameCompare);
    users.forEach(function (user) {
      var userID = user.id;
      var rowElement = $('<tr/>');
      rowElement.append( $('<td/>').text( user.login ) );
      rowElement.append( $('<td/>').text( user.fullName ) );
      rowElement.append( $('<div/>').css('width', '100px').css('height', '20px').css('background-color', '#' + this.space.userColormap[userID].getHexString()) );
      $('#usercolormap-table > tbody:last').append( rowElement );
    }, this);
  };

  WebGLApplication.prototype.toggleInvertShading = function() {
    this.options.invert_shading = !this.options.invert_shading;
    if (this.options.shading_method === 'none') return;
    this.set_shading_method();
  };

  WebGLApplication.prototype.setFollowActive = function(value) {
    this.options.follow_active = value ? true : false;
    // If active node following was enabled, center active node right away
    if (value) this.look_at_active_node();
    else this.space.render();
  };

  WebGLApplication.prototype.adjustStaticContent = function() {
    this.space.staticContent.adjust(this.options, this.space);
    this.space.render();
  };

  WebGLApplication.prototype.adjustContent = function() {
    this.space.content.adjust(this.options, this.space, this.submit);
    this.space.render();
  };

  WebGLApplication.prototype.setDebug = function(debug) {
    this.options.debug = !!debug;
    this.space.setDebug(this.options.debug);
    this.space.render();
  };

  /**
   * Handle project location change. Static content like the z plane will be
   * updated.
   */
  WebGLApplication.prototype.handlelLocationChange = function() {
    this.space.staticContent.updateZPlanePosition(this.space, project.focusedStackViewer);
    this.space.render();
  };

  WebGLApplication.prototype._validate = function(number, error_msg, min) {
    if (!number) return null;
    var min = typeof(min) === "number" ? min : 1.0;
    var value = +number; // cast
    if (Number.isNaN(value) || value < min) return CATMAID.warn(error_msg);
    return value;
  };

  /**
   * Open a connector table with the connectors currently visisble in the 3D
   * viewer.
   */
  WebGLApplication.prototype.listConnectors = function() {
    if (this.filteredConnectors) {
      CATMAID.ConnectorSelection.showConnectors(
          this.filteredConnectors.connectorIds,
          this.filteredConnectors.skeletonIds);
    } else {
      CATMAID.ConnectorSelection.showConnectors(
          null,
          this.getSelectedSkeletons());
    }
  };

  WebGLApplication.prototype.updateSynapseClusteringBandwidth = function(value) {
    value = this._validate(value, "Invalid synapse clustering value");
    if (!value) return;
    this.options.synapse_clustering_bandwidth = value;
    if ('synapse-clustering' === this.options.connector_color) {
      var skeletons = this.space.content.skeletons;
      this.space.updateConnectorColors(this.options, Object.keys(skeletons).map(function(skid) { return skeletons[skid]; }, this));
    }
    this.space.render();
  };

  WebGLApplication.prototype.updateSkeletonLineWidth = function(value) {
    value = this._validate(value, "Invalid skeleton line width value");
    if (!value) return;
    this.options.skeleton_line_width = value;
    var sks = this.space.content.skeletons;
    Object.keys(sks).forEach(function(skid) { sks[skid].changeSkeletonLineWidth(value); });
    this.space.render();
  };

  WebGLApplication.prototype.updateSkeletonNodeHandleScaling = function(value) {
    value = this._validate(value, "Invalid skeleton node scaling value", 0);
    if (!value) return;
    this.options.skeleton_node_scaling = value;
    var sks = this.space.content.skeletons;
    Object.keys(sks).forEach(function(skid) { sks[skid].scaleNodeHandles(value); });
    this.space.render();
  };

  WebGLApplication.prototype.updateSmoothSkeletonsSigma = function(value) {
    value = this._validate(value, "Invalid sigma value");
    if (!value) return;
    this.options.smooth_skeletons_sigma = value;
    if (this.options.smooth_skeletons) this.updateSkeletons();
  };

  WebGLApplication.prototype.updateResampleDelta = function(value) {
    value = this._validate(value, "Invalid resample delta");
    if (!value) return;
    this.options.resampling_delta = value;
    if (this.options.resample_skeletons) this.updateSkeletons();
  };

  WebGLApplication.prototype.createMeshColorButton = function() {
    var buttonId = 'meshes-color' + this.widgetID,
        labelId = 'mesh-opacity' + this.widgetID;

    var onchange = (function(rgb, alpha, colorChanged, alphaChanged) {
      $('#' + labelId).text(alpha.toFixed(2));
      var color = new THREE.Color().setRGB(rgb.r, rgb.g, rgb.b);
      this.options.meshes_color = '#' + color.getHexString();
      this.options.meshes_opacity = alpha;
      if (this.options.show_meshes) {
        var material = this.options.createMeshMaterial(color, alpha);
        this.space.content.meshes.forEach(function(mesh) {
          mesh.material = material;
        });
        this.space.render();
      }
    }).bind(this);

    // Defaults for initialization:
    var options = WebGLApplication.prototype.OPTIONS;

    var colorButton = document.createElement("button");
    colorButton.setAttribute('id', buttonId);
    colorButton.appendChild(document.createTextNode('color'));
    CATMAID.ColorPicker.enable(colorButton, {
      initialColor: options.meshes_color,
      initialAlpha: options.meshes_opacity,
      onColorChange: onchange
    });

    var div = document.createElement('span');
    div.appendChild(colorButton);
    div.appendChild($(
      '<span>(Opacity: <span id="' + labelId + '">' +
        options.meshes_opacity + '</span>)</span>').get(0));
    return div;
  };

  WebGLApplication.prototype.updateActiveNodeNeighborhoodRadius = function(value) {
    value = this._validate(value, "Invalid value");
    if (!value) return;
    this.options.distance_to_active_node = value;
    if (this.options.shading_method.indexOf('near_active_node') !== -1) {
      var skid = SkeletonAnnotations.getActiveSkeletonId();
      if (skid) {
        var skeleton = this.space.content.skeletons[skid];
        if (skeleton) {
          skeleton.updateSkeletonColor(this.options);
          this.space.render();
        }
      }
    }
  };

  WebGLApplication.prototype.updateShadingParameter = function(param, value, shading_method) {
    if (!this.options.hasOwnProperty(param)) {
      console.log("Invalid options parameter: ", param);
      return;
    }
    if (shading_method === 'downstream-of-tag') {
      this.options[param] = value;
    } else {
      // Numerical only
      value = this._validate(value, "Invalid value");
      if (!value || value === this.options[param]) return;
      this.options[param] = value;
    }
    if (shading_method === this.options.shading_method) {
      this.updateSkeletonColors();
    }
  };

  /**
   * This will re-create all skeleton meshes if the shading changed.
   */
  WebGLApplication.prototype.updateNeuronShading = function(shading) {
    if ('flat' !== shading && 'lambert' !== shading) {
      CATMAID.error("Unknown shading: " + shading);
      return;
    }

    // Do nothing if the shading didn't change
    if (shading === this.options['neuron_material']) {
      return;
    }

    // Update shading and update material of all affected geometries
    this.options['neuron_material'] = shading;

    // Update nodeSphere and cylinder of each skeleton
    var staticContent = this.space.staticContent;
    staticContent.updateDynamicMaterials(this.options, true);
    this.updateSkeletonColors();
  };

  /**
   * Render loop for the given animation.
   */
  WebGLApplication.prototype.renderAnimation = function(animation, t)
  {
    // Make sure we know this animation
    this.animation = animation;
    // Quere next frame for next time point
    this.animationRequestId = window.requestAnimationFrame(
        this.renderAnimation.bind(this, animation, t + 1));

    // Update animation and then render
    animation.update(t);
    this.space.render();
  };

  /**
   * Start the given animation.
   */
  WebGLApplication.prototype.startAnimation = function(animation)
  {
    if (this.animationRequestId) {
      CATMAID.info('There is already an animation running');
      return;
    }

    if (!animation) {
      CATMAID.error("Please provide an animation to play.");
      return;
    }

    // Start animation at time point 0
    this.renderAnimation(animation, 0);
  };

  /**
   * Stop the current animation.
   */
  WebGLApplication.prototype.stopAnimation = function()
  {
    if (this.animationRequestId) {
      window.cancelAnimationFrame(this.animationRequestId);
      this.animationRequestId = undefined;
    }

    if (this.animation) {
      if (this.animation.stop) {
        this.animation.stop();
      }
      this.animation = undefined;
    }
  };

  /**
   * Create a new animation, based on the 3D viewers current state.
   */
  WebGLApplication.prototype.createAnimation = function()
  {
    // For now it is always the Y axis rotation
    var options = {
      type: 'rotation',
      axis: this.options.animation_axis,
      camera: this.space.view.camera,
      target: this.space.view.controls.target,
      speed: this.options.animation_rotation_speed,
      backandforth: this.options.animation_back_forth,
    };

    // Add a notification handler for stepwise visibility, if enabled and at least
    // one skeleton is loaded.
    var visType = this.options.animation_stepwise_visibility_type;
    if (visType !== 'all') {
      // Get current visibility map and create notify handler
      var visMap = this.space.getVisibilityMap();
      var visOpts = this.options.animation_stepwise_visibility_options;
      options['notify'] = this.createStepwiseVisibilityHandler(visMap,
          visType, visOpts);
      // Create a stop handler that resets visibility to the state we found before
      // the animation.
      options['stop'] = this.createVisibibilityResetHandler(visMap);
    }

    return CATMAID.AnimationFactory.createAnimation(options);
  };

  /**
   * Create a notification handler to be used with animations that will make
   * an additional neuron visibile with every call.
   */
  WebGLApplication.prototype.createStepwiseVisibilityHandler = function(
      visMap, type, options) {
    type = type || 'all';
    options = options || {};

    // Get all visible skeletons
    var skeletonIds = Object.keys(this.space.content.skeletons)
        .filter(function(skid) {
           return this[skid].visible;
        }, this.space.content.skeletons);

    // Return no-op handler if there are no skeletons
    if (skeletonIds.length === 0) {
      return function() {};
    }

    // Create function to animate neuron visibility
    var visibility = CATMAID.WebGLApplication.AnimationNeuronVisibilities[type];
    var widget = this;
    if ('all' === type) {
      // If all should be shown, make all visible and return no-op
      widget.space.setSkeletonVisibility(visMap, this.space.content.skeletons);
      return function() {};
    } else if (CATMAID.tools.isFn(visibility)) {
      var visibleSkeletons = [];
      return function (r) {
        visibility(options, skeletonIds, visibleSkeletons, r);
        widget.space.setSkeletonVisibility(visMap, visibleSkeletons);
      };
    } else {
      throw new CATMAID.ValueError('Don\'t recognize neuron visibility ' +
          'animation mode "' + visibility + '".');
    }
  };

  /**
   * Create a handler function that resets visibility of all loaded skeletons.
   */
  WebGLApplication.prototype.createVisibibilityResetHandler = function(visMap)
  {
    return (function() {
      this.space.setSkeletonVisibility(visMap);
      this.space.render();
    }).bind(this);
  };

  /**
   * Export an animation as WebM video (if the browser supports it). First, a
   * dialog is shown to adjust export preferences.
   */
  WebGLApplication.prototype.exportAnimation = function()
  {
    var dialog = new CATMAID.OptionsDialog("Animation export options");
    dialog.appendMessage('Adjust the animation export settings to your liking. ' +
       'The resulting file will be in WebM format and might take some seconds ' +
       'to be generated. The default frame size matches the current size of ' +
       'the 3D viewer.');

    // Add options to dialog
    var rotationsField = dialog.appendField("# Rotations: ",
        "animation-export-num-rotations", '1');
    var rotationtimeField = dialog.appendField("Rotation time (s): ",
        "animation-export-rotation-time", '5');
    var frameWidthField = dialog.appendField("Frame width (px): ",
        "animation-export-frame-width", this.space.canvasWidth);
    var frameHeightField = dialog.appendField("Frame height (px): ",
        "animation-export-frame-height", this.space.canvasHeight);
    var framerateField = dialog.appendField("Frame rate: ",
        "animation-export-frame-rate", '25');
    var backforthField = dialog.appendCheckbox('Back and forth',
        'animation-export-backforth', false);
    var camera = this.space.view.camera;
    var target = this.space.view.controls.target;
    var rotationAxis = this.options.animation_axis;

    var docURL = CATMAID.makeDocURL('user_faq.html#faq-3dviewer-webm');
    dialog.appendHTML('Note: you can convert the resulting WebM file to ' +
        'other formats. Have a look at the <a href="' + docURL +
        '" target="_blank">documentation</a> for more information.');

    dialog.onOK = handleOK.bind(this);

    dialog.show(400, 450, true);

    function handleOK() {
      /* jshint validthis: true */ // `this` is bound to this WebGLApplication
      $.blockUI({message: '<img src="' + CATMAID.staticURL +
          'images/busy.gif" /> <span>Rendering animation frame ' +
          '<div id="counting-rendered-frames">0</div></span>'});

      // Get current visibility
      var visMap = this.space.getVisibilityMap();

      createAnimation.call(this);

      function createAnimation() {
        // Get current visibility map and create notify handler
        var visMap = this.space.getVisibilityMap();

        try {
          var axis = rotationAxis;
          var rotations = parseInt(rotationsField.value);
          var rotationtime = parseFloat(rotationtimeField.value);
          var framerate = parseInt(framerateField.value);

          var nframes = Math.ceil(rotations * rotationtime * framerate);
          var speed = 2 * Math.PI / (rotationtime * framerate);
          var width = parseInt(frameWidthField.value);
          var height = parseInt(frameHeightField.value);

          // Collect options
          var options = {
            type: 'rotation',
            axis: axis,
            speed: speed,
            camera: camera,
            target: target,
            backandforth: backforthField.checked,
          };

          // Add a notification handler for stepwise visibility, if enabled and at least
          // one skeleton is loaded.
          if ('all' !== this.options.animation_stepwise_visibility_type) {
            var visType = this.options.animation_stepwise_visibility_type;
            var visOpts = this.options.animation_stepwise_visibility_options;
            options['notify'] = this.createStepwiseVisibilityHandler(visMap,
                visType, visOpts);
            // Create a stop handler that resets visibility to the state we found before
            // the animation.
            options['stop'] = this.createVisibibilityResetHandler(visMap);
          }

          // Indicate progress
          var counter = $('#counting-rendered-frames');
          var onStep = function(i, nframes) {
            counter.text((i + 1) + " / " + nframes);
          };

          // Save result to file
          var onDone = (function(frames) {
            // Export movie
            var output = Whammy.fromImageArray(frames, framerate);
            saveAs(output, "catmaid_3d_view.webm");

            // Reset visibility and unblock UI
            this.space.setSkeletonVisibility(visMap);
            $.unblockUI();
          }).bind(this);

          // Get frame images
          var animation = CATMAID.AnimationFactory.createAnimation(options);
          this.getAnimationFrames(animation, nframes, undefined,
              width, height, onDone, onStep);
        } catch (e) {
          // Unblock UI and re-throw exception
          this.space.setSkeletonVisibility(visMap);
          $.unblockUI();
          throw e;
        }
      }
    }
  };

  /**
   * Create a list of images for a given animation and the corresponding options.
   * By default, 100 frames are generated, starting from timepoint zero.
   * Optionally, a function can be passed in that is called after every exported
   * frame.
   */
  WebGLApplication.prototype.getAnimationFrames = function(animation, nframes,
      startTime, width, height, onDone, onStep)
  {
    // Save current dimensions and set new ones, if available
    var originalWidth, originalHeight;
    if (width && height) {
      if (width !== this.space.canvasWidth || height !== this.space.canvasHeight) {
        originalWidth = this.space.canvasWidth;
        originalHeight = this.space.canvasHeight;
      }
    }

    onStep = onStep || function() {};
    nframes = nframes || 100;
    startTime = startTime || 0;
    var frames = new Array(nframes);

    // Render each frame in own timeout to be able to update UI between frames.
    setTimeout(renderFrame.bind(this, animation, startTime, 0, nframes, frames,
          width, height, onDone, onStep), 5);

    function renderFrame(animation, startTime, i, nframes, frames, w, h, onDone, onStep) {
      /* jshint validthis: true */ // `this` is bound to this WebGLApplication
      animation.update(startTime + i);
      // Make sure we still render with the correct size and redraw
      this.resizeView(w, h);
      // Add image to output array and callback
      frames[i] = this.space.view.getImageData('image/webp');

      onStep(i, nframes);

      // Render next frame if there are more frames
      var nextFrame = i + 1;
      if (nextFrame < nframes) {
        setTimeout(renderFrame.bind(this, animation, startTime, nextFrame,
              nframes, frames, w, h, onDone, onStep), 5);
      } else {
        // Restore original dimensions
        if (originalWidth && originalHeight) {
          this.resizeView(originalWidth, originalHeight);
        }

        onDone(frames);
      }
    }
  };

  /** Measure distances along cable to synapses or other features, and count synapses. */
  WebGLApplication.prototype.countObjects = function() {

    if (0 === this.getSelectedSkeletons().length) {
      CATMAID.msg("Information", "Add one or more skeletons first!");
      return;
    }

    var dialog = new CATMAID.OptionsDialog("Count");
    dialog.appendMessage("(For measurements and synapse counts of whole arbors, plot morphological measurements in the Circuit Graph Plot (the [P] icon) and then export to CSV.)");

    var kind = dialog.appendChoice("Count: ", "kind",
        ["postsynaptic sites",
         "presynaptic sites",
         "skeleton nodes tagged with..."],
        ["pre",
         "post",
         "tags"]);

    var atags = (function(skeletons) {
      var tags = Object.keys(skeletons).reduce(function(o, skid) {
        Object.keys(skeletons[skid].tags).forEach(function(tag) { o[tag] = true; });
        return o;
      }, {});
      var a = Object.keys(tags);
      a.sort();
      return a;
    })(this.space.content.skeletons);

    var tag_choice = dialog.appendChoice("Tag (if applicable): ", "tag",
        atags,
        atags);

    var reference = dialog.appendChoice("Reference node: ", "ref",
        ["active node",
         "root node"],
        ["active",
         "root"]);

    var max_distance = dialog.appendField("Max. distance (nm): ", "max", this.options.distance_to_active_node, false);

    var mode = dialog.appendChoice("Mode: ", "mode",
        ["along cable (selected arbor only)",
         "Euclidean distance (all arbors)"],
        ["cable",
         "euclidean"]);

    dialog.onOK = (function() {
      var active_node = SkeletonAnnotations.getActiveNodeId();
      var active_skid = SkeletonAnnotations.getActiveSkeletonId();
      var max = Number(max_distance.value); // TODO may fail as non-numeric
      var sks = this.space.content.skeletons;
      var tag = atags.length > 0 ? atags[tag_choice.selectedIndex] : null;

      // Select skeletons
      var skids;
      if (0 === mode.selectedIndex) {
        // Along cable (selected arbor only)
        var sk = sks[active_skid];
        if (!sk || !sk.visible) {
          CATMAID.msg("Oops", "Active skeleton not among those in the 3D Viewer");
          return;
        }
        skids = [active_skid];
      } else {
        skids = Object.keys(this.space.content.skeletons);
      }

      var countRelationFn = function(type, synapse_map) {
        return function(node) {
          var relations = synapse_map[node];
          if (!relations) return 0;
          return relations.reduce(function(sum, relation) {
            return sum + (type === relation.type ? 1 : 0);
          }, 0);
        };
      };

      // Count function generator: 'o' is a synapse map or the map of text tags, keyed by treenode ID
      var counterFn = function(skid) {
        switch (kind.selectedIndex) {
          case 0: // postsynaptic site
            return countRelationFn(1, sks[skid].createSynapseMap());
          case 1: // presynaptic site
            return countRelationFn(0, sks[skid].createSynapseMap());
          case 2: // text tag
            if (tag && sks[skid].tags[tag]) {
              return (function(tag, node) {
                var tags = this[node]; // 'this' is the tag map
                return tags && tags[tag] ? 1 : 0;
              }).bind(sks[skid].createTagMap(), tag);
            } else {
              // not present in skeleton
              return null;
            }
            // Required to make JSHint stop complaining
            /*falls through*/
          default:
            CATMAID.msg("Error", "Unknown kind");
            return null;
        }
      };

      var origin = null;
      if (0 === reference.selectedIndex && 1 === mode.selectedIndex) {
        // Use active node as reference for all skeletons
        var p = SkeletonAnnotations.getActiveNodePositionW();
        origin = new THREE.Vector3d(p.x, p.y, p.z);
      }

      var rows = [];

      skids.forEach(function(skid) {
        var counter = counterFn(skid); // will be null when nothing to count
        var count = 0;

        if (counter) {
          var positions = sks[skid].getPositions();
          var arbor = sks[skid].createArbor();

          if (0 === mode.selectedIndex) {
            // Along cable
            if (0 === reference.selectedIndex) {
              arbor.reroot(active_node); // guaranteed above to belong to the skeleton
            }
            var distances = arbor.nodesDistanceTo(arbor.root, function(child, paren) { return positions[child].distanceTo(positions[paren]); }).distances;
            arbor.nodesArray().forEach(function(node) {
              if (distances[node] < max) count += counter(node);
            });
          } else {
            // Euclidean distance
            var o = origin;
            if (1 === reference.selectedIndex) {
              var o = positions[arbor.root];
            }
            arbor.nodesArray().forEach(function(node) {
              if (o.distanceTo(positions[node]) < max) count += counter(node);
            });
          }
        }

        rows.push([skid, CATMAID.NeuronNameService.getInstance().getName(skid), count]);
      }, this);


      var csv = rows.map(function(row) {
        return row[0] + ', "' + row[1] + '", ' + row[2];
      }).join('\n');
      saveAs(new Blob([csv], {type: "text/csv"}), "counts.csv");

      if (1 === rows.length) {
        CATMAID.msg("CSV contains:", csv);
      }

    }).bind(this);

    dialog.show(400, 300, false);
  };

  // Make 3D viewer available in CATMAID namespace
  CATMAID.WebGLApplication = WebGLApplication;

})(CATMAID);
