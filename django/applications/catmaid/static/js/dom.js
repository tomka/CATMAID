/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

/* gobal
  CATMAID
*/

(function(CATMAID) {

  "use strict";

  var DOM = {};

  /**
   * Remove all elements from a parent element.
   */
  DOM.removeAllChildren = function(element) {
    while (element.lastChild) {
      element.removeChild(element.lastChild);
    }
  };

  /**
   * Helper function to create a collapsible settings container.
   */
  DOM.addSettingsContainer = function(parent, name, closed)
  {
    var content = $('<div/>').addClass('content');
    if (closed) {
      content.css('display', 'none');
    }
    var sc = $('<div/>')
      .addClass('settings-container')
      .append($('<p/>')
        .addClass('title')
        .append($('<span/>')
          .addClass(closed ? 'extend-box-closed' : 'extend-box-open'))
        .append(name))
      .append(content);

    $(parent).append(sc);

    return content;
  };

  /**
   * Create a container for help text.
   */
  DOM.createHelpText = function(text)
  {
    return $('<div/>').addClass('help').append(text);
  };

  /**
   * Helper function to add a labeled control.
   */
  DOM.createLabeledControl = function(name, control, helptext)
  {
    var label = $('<label/>')
      .append($('<span/>')
        .addClass('description')
        .append(name))
      .append(control);

    if (helptext) {
      label.append(CATMAID.DOM.createHelpText(helptext));
    }

    return $('<div/>').addClass('setting').append(label);
  };

  /**
   * Helper function to create a checkbox with label.
   */
  DOM.createCheckboxSetting = function(name, checked, helptext, handler)
  {
    var cb = $('<input/>').attr('type', 'checkbox');
    if (checked) {
      cb.prop('checked', checked);
    }
    if (handler) {
      cb.change(handler);
    }
    var label = $('<div/>')
      .addClass('setting checkbox-row')
      .append($('<label/>').append(cb).append(name));

    if (helptext) {
      label.append(CATMAID.DOM.createHelpText(helptext));
    }

    return label;
  };

  /**
   * Helper function to create a text input field with label.
   */
  DOM.createInputSetting = function(name, val, helptext, handler)
  {
    var input = $('<input/>').attr('type', 'text')
      .addClass("ui-corner-all").val(val);
    if (handler) {
      input.change(handler);
    }
    return CATMAID.DOM.createLabeledControl(name, input, helptext);
  };

  /**
   * Helper function to create a number input field with label.
   */
  DOM.createNumericInputSetting = function(name, val, step, helptext, handler)
  {
    var input = $('<input/>').attr('type', 'number')
      .attr('min', '0')
      .attr('step', undefined === step ? 1 : step)
      .addClass("ui-corner-all").val(val);
    if (handler) {
      input.change(handler);
    }

    return CATMAID.DOM.createLabeledControl(name, input, helptext);
  };

  /**
   * Helper function to create a set of radio buttons.
   */
  DOM.createRadioSetting = function(name, values, helptext, handler)
  {
    return values.reduce(function (cont, val) {
      return cont.append(CATMAID.DOM.createLabeledControl(val.desc, $('<input />').attr({
          type: 'radio',
          name: name,
          id: val.id,
          value: val.id
      }, helptext).prop('checked', val.checked).change(handler)));
    }, $('<div />'));
  };

  /**
   * Helper function to create a select element with options.
   */
  DOM.createSelectSetting = function(name, options, helptext, handler, defaultValue)
  {
    var select = document.createElement('select');
    for (var o in options) {
      var value = options[o];
      var selected = (defaultValue === value);
      var option = new Option(o, value, selected, selected);
      select.add(option);
    }
    if (handler) {
      select.onchange = handler;
    }
    return CATMAID.DOM.createLabeledControl(name, select, helptext);
  };

  /**
   * Create a file open button that can be optionally initialized hidden.
   */
  DOM.createFileButton = function(id, visible, onchangeFn) {
    var fb = document.createElement('input');
    fb.setAttribute('type', 'file');
    if (id) {
      fb.setAttribute('id', id);
    }
    fb.setAttribute('name', 'files[]');
    if (!visible) {
      fb.style.display = 'none';
    }
    fb.onchange = onchangeFn;
    return fb;
  };

  /**
   * Clones the given form into a dynamically created iframe and submits it
   * there. This can be used to store autocompletion information of a form that
   * actually isn't submitted (where e.g. an AJAX request is done manually).  A
   * search term is only added to the autocomplete history if the form is
   * actually submitted. This, however, triggers a reload (or redirect) of the
   * current page. To prevent this, an iframe is created where the submit of the
   * form is done and where a reload doesn't matter. The search term is stored
   * and the actual search can be executed.
   * Based on http://stackoverflow.com/questions/8400269.
   */
  DOM.submitFormInIFrame = function(form) {
    // Create a new hidden iframe element as sibling of the form
    var iframe = document.createElement('iframe');
    iframe.setAttribute('src', '');
    iframe.setAttribute('style', 'display:none');
    form.parentNode.appendChild(iframe);
    // Submit form in iframe to store autocomplete information
    var iframeWindow = iframe.contentWindow;
    iframeWindow.document.body.appendChild(form.cloneNode(true));
    var frameForm = iframeWindow.document.getElementById(form.id);
    frameForm.onsubmit = null;
    frameForm.submit();
    // Remove the iframe again after the submit (hopefully) run
    setTimeout(function() { form.parentNode.removeChild(iframe); }, 100);
  };

  /**
   * Inject an extra button into the caption of a window. This button can be
   * assigned style classes and a click handler.
   */
  DOM.addCaptionButton = function(win, iconClass, title, handler) {
    var toggle = document.createElement('i');
    toggle.setAttribute('class', iconClass);
    toggle.classList.add('windowButton');
    toggle.onmousedown = handler;

    if (title) {
      toggle.setAttribute('title', title);
    }

    $('.stackTitle', win.getFrame()).after(toggle);

    return toggle;
  };

  /**
   * Inject a help button into the caption of a window. This button opens a
   * widget containing the passed help text when clicked.
   *
   * @param {CMWWindow} win          Window to which the button with be added.
   * @param {string}    title        Title of the help window that will open.
   * @param {string}    helpTextHtml HTML source of the help text.
   */
  DOM.addHelpButton = function (win, title, helpTextHtml) {
    var helpTextFeedback =
        '<p class="ui-state-highlight ui-widget">' +
        'Is this documentation incomplete or incorrect? Help out by ' +
        '<a target="_blank" href="' +
        CATMAID.makeDocURL('contributing.html#in-client-documentation') +
        '">letting us know or contributing a fix.</a></p>';
    DOM.addCaptionButton(win,
        'fa fa-question',
        'Show help documentation for this widget',
        function () {
          WindowMaker.create('html', {title: title,
                                      html: helpTextHtml + helpTextFeedback});
        });
  };


  // A toggle function that also allows to recreate the UI.
  function toggleWindowConfigurationPanel(win, recreate) {
    // Create controls for the window settings if not present, otherwise remove
    // them.
    var frame = win.getFrame();
    var panel = frame.querySelector('.window-settings');
    var show = !panel;

    if (!show) {
      panel.remove();
    }

    if (show || recreate) {
      // Create new panel
      panel = document.createElement('div');
      panel.setAttribute('class', 'window-settings');

      // Add window alias input field
      

      // Add as first element after caption and event catcher
      var eventCatcher = frame.querySelector('.eventCatcher');
      if (eventCatcher) {
        // insertBefore will handle the case where there is no next sibling,
        // the element will be appended to the end.
        frame.insertBefore(panel, eventCatcher.nextSibling);
      }
    }

    return show;
  }

  /**
   * Inject a caption button that toggles window related settings.
   *
   * @param {CMWWindow} win          Window to which the button with be added.
   */
  DOM.addWindowConfigButton = function(win) {
    DOM.addCaptionButton(win, 'fa fa-window-maximize',
        'Show window settings for this widget',
        toggleWindowConfigurationPanel.bind(window, win, false));
  };


  /**
   * Inject an extra button into the caption of a window. This button allows to
   * show and hide a windows button panel (a top level element of class
   * buttonpanel).
   */
  DOM.addButtonDisplayToggle = function(win, title) {
    title = title || 'Show and hide widget controls';
    DOM.addCaptionButton(win, 'fa fa-gear', title, function() {
      var frame = $(this).closest('.' + CMWNode.FRAME_CLASS);
      var panels = $('.buttonpanel', frame);
      if (panels.length > 0) {
       // Toggle display of first button panel found
        var style = 'none' === panels[0].style.display ? 'block' : 'none';
        panels[0].style.display = style;
      }
    });
  };

  /**
   * Inject an extra button into the caption of a window. This button allows to
   * show and hide skeleton source controls for a widget.
   */
  DOM.addSourceControlsToggle = function(win, source, title, options) {
    title = title || 'Show and hide skeleton source controls';

    // A toggle function that also allows to recreate the UI.
    var toggle = function(recreate) {
      // Create controls for the skeleton source if not present, otherwise
      // remove them.
      var frame = win.getFrame();
      var panel = frame.querySelector('.sourcepanel');
      var show = !panel;

      if (!show) {
        panel.remove();
      }

      if (show || recreate) {
        // Create new panel
        panel = CATMAID.skeletonListSources.createSourceControls(source, options);
        panel.setAttribute('class', 'sourcepanel');
        // Add as first element after caption and event catcher
        var eventCatcher = frame.querySelector('.eventCatcher');
        if (eventCatcher) {
          // insertBefore will handle the case where there is no next sibling,
          // the element will be appended to the end.
          frame.insertBefore(panel, eventCatcher.nextSibling);
        }
      }

      return show;
    };

    // Make a update function that can be referred to from handlers
    var update = toggle.bind(window, true);

    return DOM.addCaptionButton(win, 'fa fa-link', title, function() {
      // Do a regular toggle update by default
      var opened = toggle();

      if (opened) {
        // Register to the source's subscription added and removed
        // events to recreate the UI.
        source.on(source.EVENT_SUBSCRIPTION_ADDED, update);
        source.on(source.EVENT_SUBSCRIPTION_REMOVED, update);
      } else {
        source.off(source.EVENT_SUBSCRIPTION_ADDED, update);
        source.off(source.EVENT_SUBSCRIPTION_REMOVED, update);
      }
    });
  };

  /**
   * Create a new select element that when clicked (or optionally hovered) shows
   * a custom list in a DIV container below it. This custom list provides
   * checkbox elements for each entry
   *
   * Main idea from: http://stackoverflow.com/questions/17714705
   *
   * @param title        {String}   A title showing as the first element of the select
   * @param options      {Object[]} A list of {title: <>, value: <>} objects.
   * @param selectedKeys {String[]} (Optional) list of keys that should be
   *                                selected initially
   *
   * @returns a wrapper around the select element
   */
  DOM.createCheckboxSelect = function(title, options, selectedKeys) {
    var selectedSet = new Set(selectedKeys ? selectedKeys : undefined);
    var checkboxes = document.createElement('ul');
    for (var i=0; i<options.length; ++i) {
      var o = options[i];
      var entry = document.createElement('label');
      var checkbox = document.createElement('input');
      checkbox.setAttribute('type', 'checkbox');
      checkbox.setAttribute('value', o.value);
      entry.appendChild(checkbox);
      entry.appendChild(document.createTextNode(o.title));
      if (selectedSet.has(o.value)) {
        checkbox.checked = true;
      }
      checkboxes.appendChild(entry);
    }
    checkboxes.onclick = function(e) {
      // Cancel bubbling
      e.cancelBubble = true;
      if (e.stopPropagation) e.stopPropagation();
    };

    return CATMAID.DOM.createCustomContentSelect(title, checkboxes);
  };

  /**
   * Create a new select element that when clicked (or optionally hovered) shows
   * content in a DIV container below it.
   *
   * Main idea from: http://stackoverflow.com/questions/17714705
   *
   * @param title {String}   A title showing as the first element of the select
   * @param content {Object} Content to be displayed when select is clicked
   *
   * @returns a wrapper around the select element
   */
  DOM.createCustomContentSelect = function(title, content) {
    // Expandable container
    var container = document.createElement('span');
    container.setAttribute('class', 'customselect');

    var selectBox = document.createElement('div');
    selectBox.setAttribute('class', 'customselect-selectbox');

    var toggleSelect = document.createElement('select');
    toggleSelect.options.add(new Option(title));
    selectBox.appendChild(toggleSelect);

    // Hide the selects drop down menu, which is needed for creating our own
    // drop down as well as for showing thre rest of the panel if the menu is
    // expanded.
    var overSelect = document.createElement('div');
    overSelect.setAttribute('class', 'customselect-overselect');
    selectBox.appendChild(overSelect);

    container.appendChild(selectBox);

    var customContent = document.createElement('div');
    customContent.setAttribute('class', 'customselect-content');
    customContent.style.display = "none";
    customContent.appendChild(content);
    container.appendChild(customContent);

    // The function responsible for hiding and showing all controls has a
    // private state variable and an IIFE is used to encapsulate it (to reduce
    // closure size).
    var toggleExpansion = (function() {
      var expanded = false;
      return function(e) {
        var customContent = this.querySelector('div.customselect-content');
        if (expanded) {
          customContent.style.display = 'none';
        } else {
          customContent.style.display = 'block';
        }
        expanded = !expanded;
      };
    })();

    // Expand whe the container is clicked
    container.onclick = toggleExpansion;
    toggleSelect.onclick = function(e) {
      toggleExpansion(e);
      return false; // Don't bubble up
    };

    // This wrapper is used to make the actual control container expand more
    // reliable.
    var wrapper = document.createElement('span');
    wrapper.appendChild(container);

    return wrapper;
  };

  /**
   * Create a simple placeholder.
   */
  DOM.createPlaceholder= function() {
    var placeholder = document.createElement('span');
    placeholder.classList.add('placeholder');
    var img = document.createElement('img');
    img.src = CATMAID.makeStaticURL('images/wait_bgtransgrey.gif');
    placeholder.appendChild(img);
    return placeholder;
  };

  /**
   * Create a placeholder element that will get replaced once async content has
   * been loaded, i.e. the passed in promise has been resolved. The promise is
   * expected to return the actual element to be displayed.
   */
  DOM.createAsyncPlaceholder= function(promise) {
    var placeholder = CATMAID.DOM.createPlaceholder();
    if (!promise || !CATMAID.tools.isFn(promise.then)) {
      throw new CATMAID.ValueError('Async musst be either a callback or promise');
    }

    // After promise is fulfilled, replace placeholder
    promise.then(function(element) {
      if (placeholder.parentNode) {
        placeholder.parentNode.replaceChild(element, placeholder);
      } else {
        throw new CATMAID.ValueError('Placeholder node doesn\'t have a parent');
      }
    }).catch(CATMAID.handleError);

    return placeholder;
  };

	DOM.createCheckbox = function(label, value, onclickFn) {
		var cb = document.createElement('input');
		cb.setAttribute('type', 'checkbox');
		cb.checked = value ? true : false;
		cb.onclick = onclickFn;
		return [cb, document.createTextNode(label)];
	};

  /**
   * Create a new numeric field based on the passed in configuration.
   */
  DOM.createNumericField = function(id, label, title, value, postlabel, onchangeFn, length, placeholder) {
    var nf = document.createElement('input');
    if (id) nf.setAttribute('id', id);
    nf.setAttribute('type', 'text');
    nf.setAttribute('value', value);

    if (placeholder) {
      nf.setAttribute('placeholder', placeholder);
    }

    if (length) nf.setAttribute('size', length);
    if (onchangeFn) nf.onchange = onchangeFn;
    if (label || postlabel) {
      var labelEl = document.createElement('label');
      labelEl.setAttribute('title', title);
      if (label) labelEl.appendChild(document.createTextNode(label));
      labelEl.appendChild(nf);
      if (postlabel) labelEl.appendChild(document.createTextNode(postlabel));
      return labelEl;
    } else {
      return nf;
    }
  };

  /**
   * Create a new date field based on the passed in configuration, optionally
   * show time selector.
   */
  DOM.createDateField = function(id, label, title, value, postlabel, onchangeFn,
      length, placeholder, time) {
    var df = document.createElement('input');
    if (id) df.setAttribute('id', id);
    df.setAttribute('type', 'text');
    df.setAttribute('value', value);

    if (placeholder) {
      df.setAttribute('placeholder', placeholder);
    }

    if (length) df.setAttribute('size', length);
    if (onchangeFn) df.onchange = onchangeFn;
    if (label || postlabel) {
      var labelEl = document.createElement('label');
      labelEl.setAttribute('title', title);
      if (label) labelEl.appendChild(document.createTextNode(label));
      labelEl.appendChild(df);
      if (postlabel) labelEl.appendChild(document.createTextNode(postlabel));
      return labelEl;
    } else {
      return df;
    }
  };

  DOM.createSelect = function(id, items, selectedValue) {
    var select = document.createElement('select');
    if (id) {
      select.setAttribute("id", id);
    }
    items.forEach(function(item, i) {
      var option = document.createElement("option");
      var itemType = typeof item;
      var text, value;
      if ('object' === itemType) {
        text = item.title;
        value = item.value;
      } else {
        text = item;
        value = item;
      }
      option.text = text;
      option.value = value;
      if (option.value === selectedValue) {
        option.defaultSelected = true;
        option.selected = true;
      }
      select.appendChild(option);
    });
    return select;
  };

  /**
   * Create a tab group and add it to the passed in container. The widget ID is
   * expected to be unique.
   */
  DOM.addTabGroup = function(container, widgetId, titles) {
    var ul = document.createElement('ul');
    container.appendChild(ul);
    return titles.reduce(function(o, name) {
      var id = name.replace(/ /, '') + widgetId;
      ul.appendChild($('<li><a href="#' + id + '">' + name + '</a></li>')[0]);
      var div = document.createElement('div');
      div.setAttribute('id', id);
      container.appendChild(div);
      o[name] = div;
      return o;
    }, {});
  };

  /**
   * Construct elements from an array of parameters and append them to a tab
   * element.

   * @param {Element}     tab   The tab to which to append constructed elements.
   * @param {Array.<(Object|Array)>} elements
   *                             An array of parameters from which to construct
   *                             elements. The elements of the array are either
   *                             arrays of parameters, in which case the length
   *                             of the array is used to choose element type, or
   *                             an object specifying parameters, in which case
   *                             the `type` property specifies element type.
   * @return {Element[]}         An array of the constructed elements.
   */
  DOM.appendToTab = function(tab, elements) {
    return elements.map(function(e) {
      if (Array.isArray(e)) {
        switch (e.length) {
          case 1: return tab.appendChild(e[0]);
          case 2: return CATMAID.DOM.appendButton(tab, e[0], undefined, e[1]);
          case 3: return CATMAID.DOM.appendButton(tab, e[0], undefined, e[1], e[2]);
          case 4: return CATMAID.DOM.appendCheckbox(tab, e[0], e[0], e[1], e[2], e[3]);
          case 5: return CATMAID.DOM.appendNumericField(tab, e[0], e[0], e[1], e[2], e[3], e[4]);
          default: return undefined;
        }
      } else {
        switch (e.type) {
          case 'child':
            return tab.appendChild(e.element);
          case 'button':
            return CATMAID.DOM.appendButton(tab, e.label, e.title, e.onclick, e.attr);
          case 'checkbox':
            return CATMAID.DOM.appendCheckbox(tab, e.label, e.title, e.value, e.onclick, e.left);
          case 'numeric':
            return CATMAID.DOM.appendNumericField(tab, e.label, e.title, e.value, e.postlabel, e.onchange, e.length, e.placeholder);
          case 'date':
            return CATMAID.DOM.appendDateField(tab, e.label, e.title, e.value,
                e.postlabel, e.onchange, e.length, e.placeholder, e.time);
          case 'select':
            return CATMAID.DOM.appendSelect(tab, e.id, e.label, e.entries, e.title, e.value, e.onchange);
          default: return undefined;
        }
      }
    });
  };

  /**
   * Append a new button to another element.
   */
  DOM.appendButton = function(div, label, title, onclickFn, attr) {
    var b = document.createElement('input');
    if (attr) Object.keys(attr).forEach(function(key) { b.setAttribute(key, attr[key]); });
    b.setAttribute('type', 'button');
    b.setAttribute('value', label);
    if (title) {
      b.setAttribute('title', title);
    }
    b.onclick = onclickFn;
    div.appendChild(b);
    return b;
  };

  /**
   * Append a new checkbox to another element.
   */
  DOM.appendCheckbox = function(div, label, title, value, onclickFn, left) {
    var labelEl = document.createElement('label');
    labelEl.setAttribute('title', title);
    var elems = DOM.createCheckbox(label, value, onclickFn);
    if (left) elems.reverse();
    elems.forEach(function(elem) { labelEl.appendChild(elem); });
    div.appendChild(labelEl);
    return left ? elems[elems.length - 1] : elems[0];
  };

  /**
   * Append a new numeric input field to another element.
   */
  DOM.appendNumericField = function(div, label, title, value, postlabel, onchangeFn, length, placeholder) {
    var field = DOM.createNumericField(undefined, label, title, value, postlabel, onchangeFn, length, placeholder);
    div.appendChild(field);
    return field;
  };

  /**
   * Append a new date input field to another element.
   */
  DOM.appendDateField = function(div, label, title, value, postlabel,
      onchangeFn, length, placeholder, time) {
    var field = DOM.createDateField(undefined, label, title, value, postlabel,
        onchangeFn, length, placeholder, time);
    div.appendChild(field);
    return field;
  };

  /**
   * Append a new select element to another element.
   */
  DOM.appendSelect = function(div, id, label, entries, title, value, onChangeFn) {
    id = id ? (div.id + '_' + id) : undefined;
    var select = CATMAID.DOM.createSelect(id, entries, value);
    div.appendChild(select);
    if (title) {
      select.title = title;
    }
    if (onChangeFn) {
      select.onchange= onChangeFn;
    }
    if (label) {
      var labelElement = document.createElement('label');
      labelElement.setAttribute('title', title);
      labelElement.appendChild(document.createTextNode(label));
      labelElement.appendChild(select);
      div.appendChild(labelElement);
    }
    return select;
  };

  // Export DOM namespace
  CATMAID.DOM = DOM;

})(CATMAID);

