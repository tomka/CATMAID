/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

  "use strict";

  /**
   * Show a dialog window that includes a pre-configured 3D viewer next to an
   * optional control pane.
   */
  var Confirmation3dDialog = function(options) {
    options = options || {};
    this.dialog = document.createElement('div');
    if (options.id) {
      this.dialog.setAttribute("id", options.id);
    }
    if (options.title) {
      this.dialog.setAttribute("title", options.title);
    }

    // Dialog dimensions
    this.width = parseInt(CATMAID.tools.getDefined(
        options.width, CATMAID.UI.getFrameWidth() * 0.8), 10);
    this.height = parseInt(CATMAID.tools.getDefined(
        options.height, CATMAID.UI.getFrameHeight() * 0.8), 10);
    this.usableHeight = this.height - 100;

    // Buttons and display options
    if (options.buttons) {
      this.buttons = options.buttons;
    }
    this.showControlPanel = !!CATMAID.tools.getDefined(options.showControlPanel, true);
    this.showExtraButtons = !!CATMAID.tools.getDefined(options.showExtraButtons, true);
    this.controlPanelWidth = CATMAID.tools.getDefined(options.controlPanelWidth, 250);

    if (!this.showControlPanel) {
      this.controlPanelWidth = 0;
    }

    // 3D viewer options
    this.shadingMethod = options.shadingMethod;
    this.colorMethod = options.colorMethod;
    this.lookAtActive = !!CATMAID.tools.getDefined(options.lookAtActive, true);

    // Confirmation options
    if (CATMAID.tools.isFn(options.confirm)) {
      this.confirm = options.confirm;
    }
  };

  Confirmation3dDialog.prototype.close = function() {
    $(this.dialog).dialog('close');
  };

  Confirmation3dDialog.prototype.destroy = function() {
    $(this.dialog).dialog('destroy');
  };

  Confirmation3dDialog.prototype.confirm = function() {
    return true;
  };

  Confirmation3dDialog.prototype.onSettingChanged = function(name, value) {};

  /**
   * Create 3D viewer and optional components.
   *
   * @param {Element} target Optional, a target element for the created DOM
   * elements. Defaults to just the vi.
   */
  Confirmation3dDialog.prototype.populate = function(target) {
    var self = this;
    target = target || this.dialog;

    var left = document.createElement('div'),
        right = document.createElement('div');

    target.style.display = 'grid';
    target.style.gridGap = '1%';
    left.style.gridColumn = '1';
    right.style.gridColumn = '2';

    // Position columns
    if (this.showControlPanel) {
      target.style.gridTemplate = '100% / ' + this.controlPanelWidth + 'px 1fr';
    } else {
      target.style.gridTemplate = '100% / 0 1fr';
      left.style.display = 'none';
    }

    // This helps with small errors when guessing the available pixel size for
    // the 3D viewer.
    right.style.overflow = 'hidden';

    target.appendChild(left);
    target.appendChild(right);

    // Make both containes accessible to extensions
    this.controlPanel = left;
    this.viewerPanel = right;

    // Create a 3D View that is not a SkeletonSource neither in an instance registry
    var W = function() {};
    W.prototype = CATMAID.WebGLApplication.prototype;
    this.webglapp = new W();
    // add to the right
    this.webglapp.init((this.width - this.controlPanelWidth),
        this.usableHeight, right);

    if (this.shadingMethod) {
      this.webglapp.options.shading_method = this.shadingMethod;
    }

    if (this.coloringMethod) {
      this.webglapp.options.color_method = this.colorMethod;
    }

    if (this.lookAtActive) {
      this.webglapp.look_at_active_node();
    }

    // Create controls and handlers for 3d viewer settings
    var customOptions = document.createElement('div');
    customOptions.setAttribute('class', 'ui-dialog-extra-buttonset');

    if (this.showExtraButtons) {
      var showInputsCb = document.createElement('input');
      showInputsCb.setAttribute('type', 'checkbox');
      showInputsCb.setAttribute('class', 'ui-button');
      showInputsCb.checked = true;
      showInputsCb.onchange = function() {
        var skeletonIds = self.webglapp.getSelectedSkeletons();
        for (var i=0; i<skeletonIds.length; ++i) {
          var skeletonId = skeletonIds[i];
          self.webglapp.setSkeletonPostVisibility(skeletonId, this.checked);
        }
        self.onSettingChanged('show-inputs', this.checked);
      };
      var showInputs = document.createElement('label');
      showInputs.appendChild(showInputsCb);
      showInputs.appendChild(document.createTextNode('Show inputs'));
      customOptions.appendChild(showInputs);

      var showOutputsCb = document.createElement('input');
      showOutputsCb.setAttribute('type', 'checkbox');
      showOutputsCb.setAttribute('class', 'ui-button');
      showOutputsCb.checked = true;
      showOutputsCb.onchange = function() {
        var skeletonIds = self.webglapp.getSelectedSkeletons();
        for (var i=0; i<skeletonIds.length; ++i) {
          var skeletonId = skeletonIds[i];
          self.webglapp.setSkeletonPreVisibility(skeletonId, this.checked);
        }
        self.onSettingChanged('show-outputs', this.checked);
      };
      var showOutputs = document.createElement('label');
      showOutputs.appendChild(showOutputsCb);
      showOutputs.appendChild(document.createTextNode('Show outputs'));
      customOptions.appendChild(showOutputs);

      var strahlerShadingCb = document.createElement('input');
      strahlerShadingCb.setAttribute('type', 'checkbox');
      strahlerShadingCb.setAttribute('class', 'ui-button');
      strahlerShadingCb.checked = false;
      strahlerShadingCb.onchange = function() {
        var shading = this.checked ? 'strahler' :'active_node_split';
        self.webglapp.options.shading_method = shading;
        self.webglapp.updateSkeletonColors();
        self.onSettingChanged('strahler-shading', this.checked);
      };
      var strahlerShading = document.createElement('label');
      strahlerShading.appendChild(strahlerShadingCb);
      strahlerShading.appendChild(document.createTextNode('Strahler index shading'));
      customOptions.appendChild(strahlerShading);
    }

    // Add extra options to the button pane
    $(".ui-dialog-buttonpane", this.dialog.parent).prepend(customOptions);

    // Make custom options easier accessible for dialog extensions
    this.customOptions = customOptions;

    // Resize 3D viewer if window size changes
    $(this.dialog).on('dialogresize', function(event, ui) {
      if (self.webglapp) {
        var newWidth = (Math.floor(ui.size.width) - self.controlPanelWidth);
        var newHeight = (Math.floor(ui.size.height) - 100);
        self.webglapp.resizeView(newWidth, newHeight);
      }
    });
  };

  Confirmation3dDialog.prototype.show = function(modal) {
    var self = this;
    $(this.dialog).dialog({
      width: self.width,
      height: self.height,
      modal: CATMAID.tools.getDefined(modal, true),
      close: function(ev, ui) {
        if (self.webglapp) {
          self.webglapp.destroy();
        }
        self.destroy();
      },
      buttons: self.buttons ? self.buttons : {
        "Cancel": function() {
          self.close();
          if (self.onCancel) self.onCancel();
        },
        "OK": function() {
          if (self.confirm()) {
            self.close();
            if (self.onOK) self.onOK();
          }
        }
      }
    });

    // The dialog is populated after creation, since the 3D viewer expects
    // elements to be added to the DOM.
    this.populate();
  };

  // Export 3D confirmation dialog
  CATMAID.Confirmation3dDialog = Confirmation3dDialog;

})(CATMAID);
