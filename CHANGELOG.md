## Under development

### Notes

- A virtualenv upgrade is required.


### Features and enhancements

Tracing overlay:

- Visibility groups can be defined that hide or show nodes in the overlay
  based upon filtering criteria such as neuron meta-annotations or node
  creator. Unlike the skeleton source based visibility, visibility groups can be
  toggled instantly with HOME (for group 1) or Shift + HOME (for group 2). For
  meta-annotation based visibility, this does not require using a search as a
  skeleton source, and the set of skeletons matched by the meta-annotations is
  transparently refreshed in the background. Another visibility group,
  "Always visible", establishes a set of filters for overriding hidden groups
  such that skeletons matched by these filters will always be shown.


3D viewer:

- Through the "List connectors" button on the Main tab, it is now possible to
  open a connector selection with all currently loaded connectors in it.
  Skeleton visibility and connector restrictions are respected.


Importer:

- Projects and stacks available on remote servers can now be imported,
  optionally with API-key authentication on other CATMAID instances.  The remote
  data source can of course be any URL in a JSON or YAML format understood by
  CATMAID. The import section in the CATMAID documentation holds more detail on
  this. For CATMAID, the new "projects/export" endpoint provides all required
  data that is visible to the requesting user.


Graph widget:

- The new button "Open Connectivity Matrix" in the Export tab will open a new
  Connectivity Matrix widget for the current graph, including its groups.


Connectivity matrix:

- It is now possible to manually change the order of multiple entries at once,
  which is useful to move sets of entries. The "Display" tab now has a "Manually
  edit order" option. If checked, number input boxes are shown next to each row
  and column head as well as a "Re-order" button in the top-left cell if the
  table. After the numbers are adjusted to the desired order, the "Re-order"
  button will apply the new ordering. Negative and decimal numbers can be used.

- Connectivity matrices can now be exported as PDF. The "Export PDF" button on
  the "Main" tab will open a dialog explaining that this PDF export is made
  through having the browser print the table and how to enable colors. Pressing
  "Print" will show the browser's print dialog for only the table.


Settings widget:

- Tracing overlay colors customized in the settings widget are now persistent.

- Neuron name settings customized in the settings widget are now persistent.

- The delimiter used to separate annotations in a neuron name can now be
  configured in the Annotations section of the Settings Widget.

- It is now possible to configure the available page length options used by
  most tables from a central place. This is done through the "Table page length
  options" setting, which is available from the Settings widget. For widgets to
  be aware of page length setting changes, they have to be reloaded.


History tables:

- Starting with this release, CATMAID will record every single change to its
  database tables in so called history tables. This makes it possible to
  reconstruct the actual history of data (e.g. neurons) and user contributions.
  Even data deleted in CATMAID can now be recovered without touching backups.


Miscellaneous:

- Alt + Y will always create a new selection table and add the active neuron
  to it. Also works with Shift.

- Images on CATMAID's front-page are now loaded lazily, i.e. they are only
  requested and shown once they come into view. This improves performance
  significantly when displaying many sample images.

- New filter "Label Color Map" will false-color stacks of label ID images.

- The button "Add annotations to neurons" above annotation lists in the
  Neuron Navigator makes it possible to send currently selected
  annotations to other neurons. Those target neurons are selected by
  choosing a skeleton source in a dialog box, which is shown to the user
  once the button is pressed.

### Bug fixes

- Additive blending between layers now works also when filters are in use. This
  allows for proper in-browser composite generation.

- Hidden nodes are no longer selected by G or Shift + Y.

- All skeleton sources are now selectable when exporting NeuroML.

- Fix "Reset to inherited default" and "Lock this setting" buttons in settings
  controls not being clickable.


## 2016.05.26

Contributors:: Albert Cardona, Andrew Champion, Tom Kazimiers

### Notes

- The default image base setting for the importer has changed. If you use the
  importer along with this setting, please update your settings.py file to now
  use IMPORTER_DEFAULT_IMAGE_BASE instead of CATMAID_IMPORT_URL. The semantics
  stay the same.


### Features and enhancements

Graph widget:

- If a skeleton is appended that already exists in a group, the group's color
  and label now doesn't change anymore. Instead a info message is shown.

- Selected edges can now be removed with the help of the "Remove" button in the
  "Selection" tab. Also, a help text icon has been added to the title bar. The
  widget help window currently only contains information on how edges/links
  between nodes can be hidden.


Volume widget:

- Preview for alpha shapes is now disabled by default due to its potential
  re-computation cost.

- Convex hull and alpha shape meshes are now only automatically re-generated on
  property changes if preview is enabled.

- Saving a new volume makes sure the volume's mesh is up-to-date and will
  re-generate it if needed. Re-generations will now also show an info dialog.
  If no mesh could be generated, saving is not allowed and the edit form will
  stay open.

- Two new filters for convex hulls and alpha shapes are now available: "only
  end nodes" (optionally including the root) and "only branch nodes". These
  will restrict the base point set for volume generation.

- Alpha shapes now use the inverse of the alpha value used so far. This makes it
  easier to use since it translates directly into nanometers.

- If a synaptic connection filter is used with Alpha shapes and convex hulls, it
  is now possible to select all synaptic nodes, regardless of the partner
  skeleton (select "None" as partner neurons), and to select both pre- and
  post-synaptic nodes at the same time.

- Alpha shapes now use a different implementation which takes a little bit more
  time to compute, but doesn't require re-computation if different alpha values
  are used. This makes finding a good alpha value much quicker. The input field
  for the alpha value to use is now also a numeric field in which arrow keys and
  mouse wheel can be used to change the value. A second numeric input allows to
  change the step size of alpha value changes.

- For preview, volumes now use the color and opacity defined in the 3D viewer.


Tile layer:

- An efficient browsing mode is now available that will not load tiles at
  the periphery of the stack viewer. This is useful to reduce data use and
  browsing latency on bandwidth-limited connections. To use this mode, increase
  the "Tile area efficiency threshold" in the tile layer controls.


3D viewer:

- Meshes and volumes can now optionally be displayed with visible faces instead
  of wireframe only.

- Volume list is now updated when new volumes are added, re-opening the widget
  is not required anymore.

- Transparent volumes are now displayed correctly.


Miscellaneous:

- If a client tries to perform an operation without having the most recent data
  available and the performed action is canceled, a more helpful dialog is now
  shown. It explains the situation and offers to refresh the client view
  (currently only nodes in the tracing layer are refreshed).


Administration:

- The image data importer available from CATMAID's admin interface supports now
  the specification of stack groups. It can also apply custom translations when
  mapping imported stacks to imported projects.


### Bug fixes

- Creating nodes using the Z key without other nodes in close proximity works
  again.

- Zoom level slider initialized correctly for stacks with eight zoom levels.

- Showing connector info for edge in Graph widget (Alt+Click) now works also if
  the source is a single neuron and the target a group or split node.

- Activate target node of a joined-in skeleton again.


## 2016.04.18

Contributors: Albert Cardona, Andrew Champion, Tom Kazimiers


### Features and enhancements

Miscellaneous:

- The skeleton projection layer can now draw the colors used from the selected
  source. This is now the default and can be changed in the settings widget with
  the help of the "Use source colors" checkbox.

- Unavailable images on CATMAID's front pages are now displayed as a gray
  placeholder box, instead of the broken image icon of the browser.

- A new volume type was added: alpha shapes can now be created in practically the
  same way as convex hull volumes are created. Alpha shapes have one additional
  parameter: alpha. It is used to filter edges for result mesh and has to be
  fairly low with our spatial dimensions. Values around 0.00001 seemed to work
  well in some cases. The preview of alpha shapes is disabled by default, because
  they can take much longer to compute.

- Materialized virtual nodes have now the correct edition time set, which make
  operations like adding a child to a virtual node work again (state checks
  prevent this with wrong edition time).

- The neuron search will now show a warning and cancel a search if a query
  annotation doesn't exist and the query term doesn't start with a forward
  slash (used for regular expressions).


### Bug fixes

- Creating synaptic connections from connector nodes across sections works
  again.

- Inserting a node along an edge will now render correctly right after using
  ctrl+alt+click.

- Merging two skeletons while the losing skeleton was loaded into another widget
  (e.g. Selection Table) doesn't trigger an error anymore.

- Undoing confidence changes works again.


## 2016.04.15

Contributors: Albert Cardona, Andrew Champion, Daniel Witvliet, Stephan Gerhard, Tom Kazimiers

### Notes

Starting with this release CATMAID uses a new database migration system. To
update an existing CATMAID instance safely, please follow these steps:

1. Make sure you have CATMAID updated to the last release (2015.12.21),
   including all database migrations and up-to-date Python packages.
2. Upgrade to this version (or a newer one) and update pip and all Python
   packages (in within your virtualenv), South can be removed afterwards:

   ```
   pip install -U pip
   pip install -r requirements.txt
   pip uninstall south
   ```

3. Remove the following variables from settings.py file (in
   `django/projects/mysite/`): `TEMPLATE_DIRS`, `TEMPLATE_DEBUG`

4. Fake initial migrations (and only the initial migration!) of the
   `contenttypes` app and apply its other migrations:

   ```
   python manage.py migrate --fake contenttypes 0001_initial
   python manage.py migrate contenttypes
   ```

5. Fake initial migrations (and only the initial migrations!) of all used
   Django applications to register current database state:

   ```
   python manage.py migrate --fake admin 0001_initial
   python manage.py migrate --fake auth 0001_initial
   python manage.py migrate --fake authtoken 0001_initial
   python manage.py migrate --fake catmaid 0001_initial
   python manage.py migrate --fake djcelery 0001_initial
   python manage.py migrate --fake guardian 0001_initial
   python manage.py migrate --fake kombu_transport_django 0001_initial
   python manage.py migrate --fake performancetests 0001_initial
   python manage.py migrate --fake sessions 0001_initial
   python manage.py migrate --fake sites 0001_initial
   python manage.py migrate --fake taggit 0001_initial
   ```

6. In the future no syncdb step is required anymore. Continue with the rest of
   the regular update procedure:

   ```
   python manage.py migrate
   python manage.py collectstatic [-l]
   ```

This procedure will only be required for upgrading an existing instance to a
release newer than 2015.12.21. It won't be needed to migrate from newer
releases.

Also note that if you are running an Apache/mod_wsgi setup (or referencing
django.wsgi), you have to re-generate your configuration with:

   ```
   ./django/create_configuration
   ```

Additionally, PostgreSQL is now required to be of version 9.4.


### Features and enhancements

Tracing overlay:

- Colors of skeleton nodes and edges in the tracing overlay can now be
  configured to follow colors from selection tables. To configure which
  skeleton sources to use to select colors, click the skeleton source control
  icon (the gear) in the title bar of the stack viewer.

- Visibility of skeletons in the tracing overlay can also be controlled by
  skeleton source subscriptions. To enable this, check "Hide skeletons not
  in the skeleton source subscriptions" in the Settings widget under Tracing
  Overlay > Skeleton colors. Note that it the tracing overlay may not update
  the visibility of some skeletons until a navigation action is performed.


Gap junctions:

- A new non-directional connector type for gap junctions can now be created
  when tracing by Alt + clicking in the tracing overlay. Edges for gap
  junctions are displayed in purple.

- Gap junction partners can optionally be displayed in a separate table in the
  Connectivity Widget by checking "Show gap junctions". This table has its
  own selections for confidence and count thresholds.


Volumes:

- The volume widget can create a new volume type: convex hulls. These can be
  created around a set of nodes from any skeleton source. Different filters can
  be combined: filters to allow only nodes that have a certain tag, a sub-arbor
  relative to such nodes (optionally occurring a definable number of times), a
  region between two tags tag or nodes that are synaptic to skeletons of another
  skeleton source. Node radii can optionally be ignored, but they are respected
  by default. A preview of the current filter set can be displayed in the first
  available 3D viewer.


3D Viewer:

- Gap junctions are displayed like synapse edges in purple.

- Stack related settings (bounding box, missing sections and z planes) are now
  moved to a tab called "Stacks".

- Stack bounding boxes and missing sections now update when stack viewer focus
  changes.

- A new sphere shading allows for a better depth perception.

- Volumes (created in the Volume Widget) can be displayed. A new selection
  control in the "View settings" tab allows to select individual volumes. They
  are colored the same way as they regular mesh. Currently, the color isn't
  updated on purpose to allow the easy creation of differently colored volumes.

- When the current Z plane is displayed, it will now have the section's images
  data mapped to it. The used zoom level (resolution) and the opacity can be
  adjusted and orthogonal stacks are supported, too.

- When restricting connectors to those shared by groups, you can now choose
  to include only those linking pre->post between the two groups in a specific
  direction.


Skeleton Projection layer:

- Instead of supporting only the display of the active skeleton, the projection
  layer can now subscribe to other skeleton sources and display multiple
  skeleton projections at the same time. The used source can be selected in the
  Settings Widget. This way, for instance, a Selection Table could provide input
  to the projection layer and effectively control which skeletons will be
  projected.  And Through its own subscriptions, the Selection Table could even
  provide a dynamic list that includes the active node.


Neuron Search:

- A search result can now be exported as CSV. Only selected rows are exported.
  The resulting CSV will contain neuron IDs and neuron names. If annotations are
  displayed, a third column includes annotations.


Undo:

- Some actions are now stored as so called commands in a history, which can be
  displayed in a dialog by pressing the F9 key. Commands in this history can are
  reversible. They can be undone either through the history dialog or by pressing
  Ctrl+Z.

- Through the history dialog, undone commands can also be redone. Of course,
  once one diverges from the list of previously undone commands by executing a
  completely new command (e.g. creating a node), redo is not possible anymore.

- The following actions are recorded into history: tag add/remove/edit,
  annotation add/remove/edit, node radius edit, neuron rename, confidence
  change, connector link/unlink and node add/insert/move/remove/.


Ontologies, classification and clustering:

- Ontology tool widgets don't reset each other anymore if they are loaded.

- The Classification Editor and Ontology Editor open sub-trees now quicker.

- Clustering ontology based classifications is much faster and works for
  multi-level ontologies on thousands of classification graphs.


Administration and Performance:

- The return type of many performance-critical queries, like querying nodes
  for the tracing overlay, is now correctly specified as 'application/json'
  rather than 'text/html'. Make sure your nginx has gzip enabled for the
  'application/json' type in its 'gzip_types' setting so that these responses
  are compressed.


Miscellaneous:

- Dragging a window into the center of another window now creates a tabbed
  window where both windows share the same area of the screen and can be
  switched between using tabs at the top of the window. Additional tabs
  can be added by dragging more windows into the center of the tabbed window.
  The active tab can be removed from the tabbed window by dragging it to
  another location in the window layout.

- Dragging a window onto the top, left, bottom, or right edge of an already
  tabbed window while holding SHIFT will add it to that location inside the
  tab.

- There is now a setting to invert the behavior of CTRL when navigating
  parent/child topology, i.e., when enabled [ and ] will navigate to the
  next real node by default, while holding CTRL will go to virtual nodes.

- Which layers are hidden when Space is held is now configurable by checkboxes
  in the Stack Viewer's layer controls.

- Scroll bar positions in widgets are now maintained when they change their
  size.

- Non-superusers can now see user analytics and proficiency reports for
  projects for which they are administrators.

- WebGL layers are now compatible with DVID stacks.

- Tile layers now have an option in the layer controls to hide the tile layer
  if the nearest section is marked as broken, rather than the default behavior
  of displaying the nearest non-broken section.

- Clustering over large sets of ontology based classification is now much faster.


### Bug fixes

- The skeleton projection layer can be used again and now renders lines with the
  same width as the tracing layer. This width can be configured in the settings
  widget.

- Color pickers will now update the color of color picker enabled DOM elements
  again.

- Fixed hiding edges with less than 2 synapses in the Graph Widget resulting
  in no edges.

- Fixed an issue where cloning the Graph Widget cloned into the wrong widget.

- Fixed an issue preventing removing split neurons from the Graph Widget.

- Fixed an intermittent exception when renaming neurons.

- Fixed a second Neuron Search widget not working properly.

- Adding a neuron to a Selection Table now re-runs the sorting scheme.

- Fixed Connectivity Matrix cloning.


## 2015.12.21

Contributors: Albert Cardona, Andrew Champion, Eric Trautman, Tom Kazimiers

### Features and enhancements

Selection table:

- A new option ("Append with batch color") allows to override the color and
  opacity of appended skeletons with the current batch color and batch opacity.
  It is deselected by default.

- Clearing the table doesn't ask for confirmation anymore. This has been removed
  for consistency with other widgets and because of the now available option to
  save/open skeleton lists.


New widget "Synapse Distribution Plot":

- For one or more neurons, plot distances of postsynaptic sites relative
	to an axon initial segment, represented by a skeleton node that is either
	computed or given via text tags.
  Each row represents the inputs contributed by a presynaptic arbor.
  Presynaptic arbors (rows) are sorted from more to less synapses.
  Presynaptic arbors can be filtered (i.e. hidden away) by a threshold
  on the number of inputs each provides, or by being listed in another
  widget that has selected skeletons.
	Individual synapses take by default the color of the postsynaptic arbor
	(that is, the arbors added via "Append"), but can be colored as well
	according to neuron colors in another widget.
  Click on an individual postsynaptic site to go to the corresponding
  skeleton node.
  Click on the legend to jump to the skeleton node representing the
  axon initial segment, relative to which all distance measurements
  where made. All presynaptic neurons are available in a separate
  skeleton source for each widget to pull neurons from.


New widget "Synapse Fraction":

- For one or more neurons, render a normalized stacked bar chart with
  the number of synapses for/from each partner skeletons (directly either
	upstream or downstream). Can group partner skeletons: add groups by
	selecting a skeleton source (another widget listing skeletons).
	Click on the legend to edit (title, color) the group, or remove it.
	Click on the legend to go to the nearest node in the partner skeleton.
	To open this new widget, open a connectivity widget and push the
	button named "Open partner chart".


Settings widget:

- Persistent settings are now scoped, so that default settings may be
  configured for an entire CATMAID instance ("global"), for each project
  ("project"), for each user ("user"), and for each user for each project
  ("session"). Only administrators have access to change project settings,
  and only superusers have access to change global settings. This allows,
  for example, administrators to set up recommended defaults for projects so
  that users only need to adjust their settings where their preferences differ
  from the project defaults. A selection box for which scope to adjust is
  at the top of the settings widget. Persistent settings will display
  information about scopes and defaults when hovering over them with the cursor.

- Administrators may also lock persistent settings so that global or project
  defaults can not be changed by users.


Graph widget:

- In the main tab, a new remove button removes skeletons in the selected
  skeleton source from the graph.


3D Viewer:

- Added new buttons under the "Export" tab to export connectors and synapses
  as CSV. And Skeletons are now exported to CSV with a new column, the radius
	at each skeleton node, and another new column for the neuron name as
	rendered by the NeuronNameService (controlled by the Settings).
	The connectors CSV contains, for each row, the connector ID, the treenode ID,
	the skeleton ID and the relation ID, mimicking the treenode_connector table.
	The synapses CSV exports two files:
	  1. The skeleton ID vs the neuron name
		2. The list of synaptic relations of any arbor visible in the 3D Viewer,
		   with columns for the presynaptic skeleton ID, its treenode ID emitting
			 the synapse, the postsynaptic skeleton ID, and its treenode ID that
			 receives the synapse.


Review system:

- Creation, deletion, and edition of synapses and relations now causes related
  nodes to become unreviewed. Changes to presynaptic relations or the connector
  itself cause all related treenodes to become unreviewed, while changes to
  postsynaptic relations affect only that specific related treenode. Changes
  to other connection relations (abutment, etc.) behave like presynaptic
  relations, propagating to all related treenodes.


Skeleton source subscriptions:

- So far some widgets allowed to synchronize their skeleton list along with
  individual property changes. This was done through a "Sync to" selection which
  pushed this information to other widgets. This has now been replaced with a
  subscription option. Many widgets allow now to react to changes in skeleton
  lists in other widgets. Widgets supporting this got a new small chain icon in
  their title bar with which a subscription management user interface can be
  shown and hidden. Widgets that contain multiple sources, like the connectivity
  matrix, have one icon per source. A hover title will show which one to use for
  each source.

- The UI allows to add subscriptions to multiple sources which can then be
  combined through set operations. Currently sources are combined in a strict
  left-associative fashion from top to bottom of the list. When "Override
  existing" is checked, widget local skeletons are not used when subscriptions
  are refreshed and will subsequently be removed. Otherwise, the local set is
  united with the first subscription before all other subscription sources are
  applied.

- The scope of individual subscriptions can be adjusted: By default each
  subscription reacts to skeletons added, removed and updated in a source. The
  "Filter" selection allows to listen to only one of these events. For instance,
  subscribing to the active skeleton with the "Only additions" filter, allows to
  collect skeletons selected active skeletons without removing them again from
  a widget.

- By default, only selected skeletons are subscribed to. This means if a
  skeleton becomes unselected in a source it is removed from the target widget.
  If the "Only selected" checkbox is unchecked, also unselected skeletons are
  added to a target widget. They are removed when skeletons are removed from the
  source and their selection state is synced.

- All widget still feature the "From [Source] Append/Clear/Refresh" work-flow.
  The subscription UI's "Pull" button does the same as the regular "Append"
  button: a one-time sync from a source.


Miscellaneous:

- Many tracing widgets now allow a user to hide their controls. A little gear
  icon in their title bar toggles their visibility.

- Rather than only specifying annotations that are used as successive
  fallbacks for labeling neurons, neuron labels can now be specified as
  arbitrary combinations of annotation-based components using a format string.
  This is still configured in the annotations section of the settings widget.

- Volumes can now be edited when clicked on in the volume widget. This will also
  display the edited volume as layer in the active stack viewer.

- Moving a node in the tracing overlay now updates its position in the database
  as soon as the mouse is released, rather than waiting until the section
  changes.

- Changes to the CATMAID API are now documented in `API_CHANGELOG.md`.

- A docker image of a running CATMAID instance is now available for
  evaluating or developing CATMAID without needing to perform a complete
  install. The latest release is available via the "stable" tag, and the
  current development version is available via the "latest" tag. To try it:

      docker run -p 8080:80 aschampion/catmaid

  Then point your browser to http://localhost:8080. The default superuser has
  username "admin" and password "admin".


### Bug fixes

- API testing URL generated by Swagger (used for the API documentation at /apis)
  now respect a sub-directory that CATMAID might run from.

- Fixed near active node shading in the 3D viewer.

- Pre- and post-synaptic edges in the tracing overlay now update when dragging
  a related treenode.


## 2015.11.16

Contributors: Albert Cardona, Andrew Champion, Tom Kazimiers


### Features and enhancements

Key shortcuts / mouse operations:

- Pressing \ now brings up a dialog to go to the nearest node with a label
  matching a query regex. If a node is active, this search is limited to the
  active skeleton. Shift + \ cycles through matching nodes in ascending
  distance order. Ctrl + \ repeats the last search regex without prompting.

- Deleting a virtual node with DELETE or Ctrl+Shift+click instead suppresses
  the virtual node. Suppressed virtual nodes are skipped during review. A
  setting is available to also skip suppressed virtual nodes during normal
  navigation with [ and ].


Selection table:

- Batch coloring is now much quicker.

- If the batch color button is pressed a second time the color picker will not
  only close but also will the batch coloring be re-applied. This won't happen
  if the color picker is closed by clicking somewhere else.

- The status text line at the bottom of the table includes now the number of
  selected neurons. This is helpful when a filter is active and more neurons are
  selected than visible.

- Sorting for visibility columns has been removed.

- Neurons part of a Selection Table can now also be filtered based on
  annotations. This can be done with the help of the input field next to the
  name filter. Like with the name filter input, pressing the Enter key will
  activate both filters and starting with a slash character ("/") will make the
  input be treated as a regular expression (to e.g. only show neurons that are
  annotated with a1 and b2, use "/a1|b2"). For now no meta-annotations are taken
  into account.

- With the help of the new "Open" and "Close" buttons, skeleton lists can be
  stored into JSON files as well as loaded from them. Along with each skeleton
  ID, the current color and opacity is stored.


Skeleton projection layer

- With the new "Skeleton color gradient" coloring mode, the skeleton's tracing
  color (currently only yellow fo the active skeleton) is used for coloring. It
  fades into downstream and upstream colors, respectively (which are black and
  white by default).

- Nodes can be selected by placing the mouse close to them (regardless if
  displayed or not) and pressing 'g'. If no node is found in close proximity
  (<50px screen space), the tracing layer's node selection is used.


Graph widget:

- Synapses can be filtered from edges based on their confidence. The confidence
  threshold is applied to the minimum of the pre- and post-synaptic relation
  confidences. Confidence filtering is applied prior to synapse count filtering.

- Synapse count coloring on edges can now be configured independently from edge
  colors.


Volumes:

- A new widget, the Volume Manager, allows to create and list volumetric
  geometries. These geometries are not yet displayable and for now only
  box volumes can be created. The widget is available through a new 3D box
  icon, last in the list of tracing tool widgets.

- New nodes can now be tested for intersection with a certain volume. The
  Tracing section of the settings widget allows to choose a volume
  against which new nodes will be tested. If they are outside of it, a
  warning will be shown.


Neuron Search:

- Partial annotations as well as regular expressions are now supported for
  searching. If the text entered in an 'annotated' search field matches a single
  existing annotation (i.e. one that would also show up in the auto-completion),
  it is used as search constraint, just like before. However, if no matching
  annotation was found, the input text is treated as a regular expression on
  annotation names if it starts with a slash character ('/'), otherwise it is
  treated as a regular search pattern over all annotations. For instance,
  finding all things that are are annotated by either A1 or B2 would look
  like '/A1|B2' or requiring annotations that end on 'xyz' could be searched for
  by '/xyz$'. This also works with sub-annotation queries.


3D viewer:

- Different neuron visibility modes are now available for animations. A
  drop down list replaces the check-box and an option dialog is shown if
  a particular animation mode requires user input. Besides the 'show one neuron
  per rotation' mode, there is now also the 'Show n neurons per rotation' mode
  and a mode which uses a pattern to explicitly define the visibility of
  particular neurons after a particular rotation. The animation export now uses
  the visibility mode selected in the 3D viewer.


Administration:

- CATMAID has been able to use DVID as a project/stack back-end and as a
  image source for quite a wile now. To make the latter option easier to setup,
  a new admin tool is available to create CATMAID stacks based on a DVID server.
  It can be found in the "Custom views" section of CATMAID's admin interface,
  labeled as "DVID stack importer". With the help of this tool on can inspect
  all available repositories and data instances on a DVID server and create a
  stack based on one data instance. CATMAID will make sure that all
  pre-conditions are met by a stack created this way.


Miscellaneous:

- By default new widgets will now select the last widget created as skeleton
  source. If wanted, this can be adjusted to the previous behavior (always
  select 'Active skeleton') through the 'Auto-select widget created last as
  source for new widgets' option in the settings widget.

- Multiple stacks opened through a URL can now optionally be opened in the same
  stack viewer window by adding "&composite=1" to the URL.

- If an already reviewed node is moved it will now become unreviewed again.

- Links clicked in the message menu will now open in a new page.


### Bug fixes

- The skeleton projection layer will now update automatically on skeleton
  changes like new or removed nodes as well as splits and merges. It will also
  not complain anymore if a connector was selected.

- Text rendered in the 3D viewer is now upright again (instead of upside-down).


## 2015.10.19

Contributors: Albert Cardona, Andrew Champion, Tom Kazimiers


### Features and enhancements

Scripting:

- The widget instance associated with the focused window can be retrieved with
  the convenience function `CATMAID.front()`.


Orthogonal views and multi-channel data:

- Stack groups can be used to relate different stacks to each other within one
  project, e.g. to make clear that some stacks are different orthogonal views or
  different channels of the same dataset. If there are stack groups defined in a
  project, they are for now available through the "Projects" menu, which
  provides sub-menus for stacks and stack groups for each project. When opened,
  the stacks of a channel based stack groups are added as layers to the first
  stack. Ortho-view stacks are all opened in a separate stack viewer.

- If a stack group consists of the three different orthogonal views for a
  dataset, the window layout is adapted automatically as soon as the stack group
  is opened. The layout will be a four-pane layout in which the left half of the
  screen is the XY view on top of the XZ view and the right half of the screen
  is the ZY view on top of a selection table.

- Since stack group are instances of the 'stackgroup' class, they can be
  referenced from within ontologies. All projects now have a 'stackgroup' class
  and the relations 'has_view' and 'has_channel' created by default. They are
  also created for projects that don't have them, yet.

- Stack groups can be created and managed from with the admin interface through
  either the new Stack group page or while editing/creating a stack.


3D viewer:

- Skeletons can be shaded by distance from a plane through the active node. The
  plane can either be a Z-plane in project space or a plane normal to the ray
  from the camera to the active node.

- New "Count" button to count the number of pre- or postsynaptic sites, or the
  number of treenodes tagged with a given text tag, within a distance of the
	active node in the selected arbor along the cable of the arbor, or within a
	given Euclidean distance for any arbor present in the 3D viewer.


Tile layer:

- WebGL rendering is now compatible with orthogonal views.

- Tiles can now be rendered either with linear pixel interpolation (previous
  default behavior) or nearest neighbor interpolation. This is controlled by
  the "Image tile interpolation" setting.


Graph widget:

- When growing by circles, the set of neurons added can be filtered to include
  only those with annotations matching a regex.


Miscellaneous:

- A new color picker replaces the color wheel. The new control hovers over other
  elements so it can be moved, has color memory slots, defaults to a smaller
  size and can be resized to show input elements for different color spaces. To
  save a color in a memory slot, click on the rectangle containing the small
  circle next to the memory slots.

- Documentation for some HTTP API endpoints is now available from your CATMAID
  server at the `/apis/` URL.


### Bug fixes

Tile layer:

- Fixed a major WebGL tile layer GPU memory leak.


3D viewer:

- In orthographic mode, the correct depth ordering is now used again.


Selection table:

- Color sorting works again.


Miscellaneous:

- An error no longer appears when selecting an un-annotated skeleton while
  neuron labels are configured to use a meta-annotation.


## 2015.9.11

Contributors: Albert Cardona, Andrew Champion, Tom Kazimiers


### Features and enhancements

Neuron Navigator:

- It is now possible to remove multiple annotations at once from a neuron. A new
  column is added to annotation tables, each annotation row has now a checkbox
  in its first column. A click on the de-annotate link in this column's header
  or footer will remove all selected annotations from the current neuron.


Tracing:

- If a single-node skeleton is merged into another skeleton, no merge dialog is
  now shown by default. All annotations of this single-node skeleton are merged
  into the target skeleton without asking. This behavior can be changed to again
  show a merge UI if the single-node skeleton has annotations (behavior so far)
  through a new entry in the Tracing section of the settings widget.


Graph widget:

- New layout modes "dagre", "cola", "spread" and "springy". The first is based
  on DAGs (directed acyclic graphs) and the last three are force-directed. To
  note that "spread" will evenly layout neurons in trying to occupy as much
  space as possible, and also leads to symmetric-looking graphs when rendering
  multiple disconnected graphs of e.g. left and right homologous neurons. Try
  it.


Connectivity matrix:

- Descending and ascending sorting is now available for all sorting modes.

- The new 'order of other' sorting mode will try to follow the column order for
  rows and vice versa. If skeletons are not found in the reference dimension,
  they are pushed to the end.


Selection table:

- When changing the color of a neuron, all other selected neurons can be colored
  at the same time, when the new 'all selected' checkbox (right above the color
  wheel) is checked.


Neuron sarch:

- The "select all" checkbox now does what it says and selects all neurons in the
  results set.

- Pagination now works like in other widgets and the number of elements per page
  can be adjusted.

- Annotations are not loaded by default anymore, but can be shown with the help
  of the new "Show annotations" checkbox.


Miscellaneous:

- When a connector is selected, basic information about it is displayed at the
  top of the window (where otherwise the neuron name is displayed).

- A neuron search result's annotation list is now kept in sync with the rest of
  the widgets. If annotations change on a listed neuron or annotation, the
  search query is re-done.

- If only transparency is changed in the batch color picker of the Selection
  Table, the transparency alone (and not the color) of the target skeletons will
  be updated. To also update the skeleton color, the color has to be changed in
  the color picker, too.


Administration:

- Adding custom code to CATMAID's front end is now easier: Add file names to the
  STATIC_EXTENSION_FILES array variable and have your web-server point the URL
  defined in STATIC_EXTENSION_URL (defaults to /staticext/) to the folder were
  those files live. CATMAID will then load those files after its own files.


### Bug fixes

- Nodes are now correctly scaled in skeleton projection layers.

- Neuron navigator now updates if a skeleton is changed (e.g. due to a merge).

- 'Sync to' selections to push changes from one widget to another (e.g. 3D
  viewer controlled by selection table) are now updated correctly, if a selected
  target is closed.

- Changing the order of rows and columns of the connectivity matrix manually
  does now work like expected.

- From within the neuron search removed annotations will now disappear again
  from the search widget after they are unlinked.

- Using the CATMAID coloring scheme in the Selection Table is not random
  anymore.

- CSV files exported from the Connectivity Widget now respect the table ordering
  and include the target neuron names.

- Spheres that intersect in the 3D viewer (e.g. somas) don't appear broken up
  anymore.

- The 3D viewer's SVG export will now correctly calculate the size of exported
  spheres (e.g. soma tags).


## 2015.7.31

Contributors: Albert Cardona, Andrew Champion, Tom Kazimiers


### Features and enhancements

Key shortcuts / mouse operations:

- Ctrl + [ or ] now navigates to the next real (non-virtual) parent or child of
  the active node, respectively.


Connectivity widget:

- Upstream and downstream partners can now be filtered by synaptic confidence
  in addition to synaptic count. Synaptic confidence filtering is applied before
  count filtering. Confidence is taken to be the minimum of the presynaptic
  and postsynaptic connector confidence.


3D Viewer:

- Tags matching a custom regex can be shown as handle spheres in addition to
  tags containing "uncertain" or "end". Note that after entering the regex in
  the "View Settings" tab the viewer must be refreshed from the "Main" tab
  before tag spheres are updated.

- The active node marker now resizes based on the radius of the active node.

- The active node marker can now optionally always be drawn on top of other
  objects, even if it is occluded.


Miscellaneous:

- A default neuron name can now be specified in the settings widget. Similar
  to annotations, the pattern "{nX}" can be used to add an automatically
  incrementing number to each new neuron created, starting at X. Omitting X
  will be interpreted to start from 1. This default name does not persist
  between sessions.

- Neuron navigator: neuron name and annotation search are now case-insensitive.

- The client now checks every 15 minutes whether it is the same version as the
  server. If not, an error dialog is shown prompting the user to refresh their
  browser.

- It is now possible to show a projection of the active skeleton in the tracing
  overlay. All nodes will be displayed in the current slice, but no interaction
  is allowed with them. This feature can be useful to get more context on the
  current location in the active skeleton. This mode can be toggled with F10 or
  through a new entry in the settings (Tracing Overlay > Active skeleton
  projection), where different parameters can be adjusted. The color for the
  upstream and downstream part can be independently changed and various shading
  modes can be selected (plain color, Z distance transparency, Strahler based
  transparency or cut off).


### Bug fixes

- 3D viewer: the correct synapse colors are now used when connectors are
  restricted.

- If annotations are added or removed, annotation search widgets are updated
  correctly. You can now search for newly created annotations without having to
  open a new search widget.

- The order of the selection table is now remembered before it is refreshed.

- Connectivity widget: common partners filtering now correctly enforces that
  partners are partnered with all target neurons, not just any two.

- Review widget: the skipped node warning will now only show up when in fact
  more nodes have been skipped than allowed.

- Fixed a vulnerability that allowed any user with "browse" access permissions
  to any project to execute arbitrary SQL statements on the CATMAID database.


## 2015.7.17

Contributors: Albert Cardona, Andrew Champion, Tom Kazimiers


### Features and enhancements

Connectivity widget:

- Partners can now be filtered by a minimum threshold on number of nodes, rather
  than only being able to filter single-node partners.

- The user's review team is now an option in the partner review filter.

- Changing the review filter no longer reloads the entire widget.

- Many small performance improvements.


Selection table:

- The table layout has been streamlined with other tables in CATMAID. All
  columns except 'action columns' can now be used for sorting. Pagination is now
  done with the buttons to the right above and below the table, the page length
  can now be adjusted, too. The summary info button moved into the button panel
  while the filter input is now part of the table.

- It is now possible to add a new annotation to individual neurons without
  changing the current selection. This can be  done with the little tag icon in
  the actions column on the right. The former info button was replaced by a
  small 'i' icon and clicking the folder icon in the same column will open a
  Neuron Navigator window for the respective neuron.

- All visibility related colums can be hidden with a new checkbox in the button
  panel. This might be useful to save space if a selection table is not used to
  control a 3D viewer.


Miscellaneous:

- Neuron search: annotations can now be searched for those by users in the
  review team.

- Log: entries can now be filtered to include only actions from the user's
  review team.

- The maximum number of nodes returned to the tracing overlay is now
  configurable as a server setting: NODE_LIST_MAXIMUM_COUNT (default 5000).

- Group graph: a new lock buttons in the Selection tab allows to lock selected
  nodes, so that their position doesn't change until they are unlocked again.


### Bug fixes

- Fix display of intermediate nodes on edge between two joined skeletons.

- The last lines of the review widget were hidden sometimes. This is not the
  case anymore.


## 2015.7.6

CATMAID now uses the GPLv3 license and moved away from the stricter
AGPLv3. This move was discussed with all previous contributors and
agreed on. See the corresponding commit for more details.

Contributors: Albert Cardona, Andrew Champion, Tom Kazimiers


### Notes

This release includes database changes that require manual intervention if you
are upgrading from an existing installation. A new dependency is now required:
PostGIS, an extension to PostgreSQL. After its installation, it has to be
activated for the CATMAID database. To do so, connect to the database using a
Postgres system user. Assuming a Postgres system user named "postgres" and a
CATMAID database named "catmaid", this could be done by calling

  sudo -u postgres psql -d catmaid

Being connected to the database, PostGIS can be enabled by executing

  CREATE EXTENSION postgis;

Now PostGIS is enabled and the connection can be closed again. Now a regular
update can be performed. Please note that this update can take quite some time
to complete. On bigger neuron tracing installations, multiple hours are
realistic.


### Features and enhancements

Key shortcuts / mouse operations:

- Ctrl + mouse wheel now zooms the stack, while shift zooms by smaller
  increments.

- Pressing X in the tracing tool will begin measuring distance from the current
  cursor position. The mouse wheel can be used to measure along the stack Z
  axis. Clicking will close the measurement tool and show the final distance in
  the status bar. ESC cancels the tool.


Multi-view tracing and virtual nodes:

- Orthogonal views on a regular XY stack can now also be used for neuron
  reconstruction. If they are available as CATMAID stacks and opened while the
  tracing tool is activated, tracing data will be shown in the respective
  orthogonal views as well. Tracing can be done in these views just like in the
  regular XY view.

- When tracing, it is not required anymore to place a node in every section. If
  no node has been placed in a section, CATMAID will place a so called virtual node
  where the skeleton and the section meet. If this virtual node is modified in
  any way, e.g. tagging, joining, moving, etc. it will be created. This also
  slightly changes the way reviews work. Review information is only stored on
  real nodes.

- The review widget has a new settings: in-between node step. It specifies how
  many sections can be skipped between adjacent real nodes. This is done with
  respect to the currently focused stack. This stack is also used to determine
  in which direction to move to look beyond the start of a segment.


Stack viewer:

- Other stacks in a project can be added to an open stack view by selecting the
  "Add to focused viewer" option from the stacks menu. This allows multiple
  stacks to exist in the same view like overlays, while accounting for
  differences in translation and resolution. The navigator will expand the
  available zoom levels to accomodate the maximum and minimum zoom possible in
  all of the open stacks.

- Tile layers for stacks added to a viewer can be removed from a viewer via an
  "x" in the tile layer control.

- Multiple viewers into the same stack can now be opened.

- Each stack viewer can be toggled between coupling its navigation with other
  open stack viewers. Toggle this via the "Navigate with project" checkbox in
  the tile layer control.


Tile layer:

- New filter (WebGL only): intensity thresholded transparency


3D Viewer:

- Connector restriction can now explicitly be turned on and off with a pull
  down list. One can select between "Show all" (i.e. restriction turned off),
  "All shared connectors" will only show connectors with partners in the current
  selection and "All pre->post connectors" will only allow connectors with at
  least one presynaptic partner and one postsynaptic partner in the current
  selection. The last option, "All group shared" allows to select two skeleton
  sources (e.g. two selection table) and it will only show connectors that are
  part of the 3D viewer and that connect between both selected groups of
  skeletons. There is also a pre->post enforcing variant of it.


Neuron search:

- The name displayed for neurons now follows the same naming mechanism used for
  other widgets. It can be controlled through the settings widget and will
  automatically update if a neuron name is changed.


Miscellaneous:

- In the connectivity widget, upstream and downstream thresholds can now be set
  at once for all seed neurons. Two drop down controls used for this will be
  displayed if there is more than one seed neuron.

- Treenode Table refurbishing: far faster, supports multiple skeletons, can do
  tag search with regular expressions and lists the skeleton treenode ID.

- Rows and columns of the connectivity matrix can now be moved around with
  little buttons that appear when the mouse is over row and column header cells.

- There are now three options to change focus if a pointer enters a window:
  don't change focus (how it has been so far), focus stacks (will activate
  stacks when hovered, but won't change focus for other windows) and focus all
  (will change focus to every window hovered). The default will be stack focus
  follows the pointer. The settings widget makes these options available in
  general settings area.

- There are three new controls in the split/merge dialog: Toggle the
  display of input and output markers on neurons in the embedded 3D viewer and
  select which shading method is used (default: "active node split").
  Alternatively, "Strahler index" coloring can be used, which helps with
  depth perception.

- Attempting to reload a CATMAID browser tab or go back in history, will now
  result in a warning dialog, asking for confirmation. It makes clear that
  CATMAID's window layout and content won't be saved if the acton isn't
  canceled.


Administration:

- Now that virtual nodes are available, existing database can (but don't have
  to) be optimized. A new management command will look for straight skeleton
  parts that are not referenced in any way and prunes them. In other words, if
  there are three successive collinear nodes and the middle one is not
  referenced, it will be removed.

  manage.py catmaid_prune_skeletons


### Bug fixes

- The Neuron Search widget doesn't throw an error anymore when a neuron listed
  in it is merged.


- There is no longer a race condition in the database during concurrent
  split/merge of a skeleton and creation of a treenode in that skeleton. While
  this is not a comprehensive guarantee of conflict-free concurrency, it does
  remove the most likely scenario resulting in corruption of the database model.


## 2015.5.27

### Bug fixes

- Fix radius based neuron selection in tracing window.


## 2015.5.19

Contributors: Tom Kazimiers


### Features and enhancements

Key shortcuts / mouse operations:

- Cycling through open end nodes will now only visit the root node if it is an
  actual leaf. That is, when it has only one child node and is untagged.


3D Viewer:

- A light background shading variant for connectors was added. It uses a darker
  cyan color which provides more contrast if a white background is used.


Miscellaneous:

- The location of messages and notifications can be configured in the settings
  widget. The default location is still the upper right corner.

- If the node display limit is hit while panning the field of view in tracing
  mode, node refresh will be temporary disabled. Once the mouse button is
  released again an no further panning happens within one second, node update is
  reset to normal. This allows for smoother panning if many nodes are visible.


### Bug fixes

Review system:

- Review teams are now respected when Shift + W is used to jump to the next
  unreviewed node.


3D viewer:

- Skeletons with other coloring than "Source", will now be visible when exported
  as SVG in the 3D viewer.


Miscellaneous:

- Skeletons added to a selection table, will now honor the table's "global"
  settings for pre, post, meta and text visibility.

- If an annotation is removed from a neuron, the annotation itself will be
  deleted, too, if it is not used anywhere else. Now also meta annotations of
  the deleted annotation will be removed (and their meta annotations...), if
  they are not used anywhere else.


## 2015.5.11

Contributors: Albert Cardona, Andrew Champion, Tom Kazimiers

### Features and enhancements

Connectivity widget:

- Partner filtering now supports regular expressions when the first character
  of the search input is "/".


Treenode table:

- *REMOVED*: Radii can no longer be edited by clicking on their cell in the
  table.


Connectivity matrix:

- The tracing tool has got a new widget: a connectivity matrix. It can be opened
  with the "M" frame icon next to the button for the connectivity widget. To use
  it, one has to append skeletons for its rows and columns. Skeletons can also
  be added as group. Each cell shows two sub-cells, the first one shows the
  number of synapses from row to column and the second one the number synapses
  from column to row. When a synapse count number is clicked, a connector
  selection is opened, that contains the corresponding synapses. Both pre- and
  post-synaptic count cells can be colored individually. By default a coloring
  similar to the tracing layer's red and cyan is used. There are also color
  gradients available to produce heat maps (i.e. color cells based on the
  actual synapse count).

- Graph widget: ability to split neurons by text tag on their skeletons. It's the
  "Tag" button under the "Subgraph" tab. Enables you to manually define regions
  on a neuronal arbor (like axon and dendrite, or multiple dendritic domains)
  and then have them be represented each as a node in the graph. The skeleton
  will be virtually cut at the nodes containing the tags, with the tagged node
  belonging to the downstream part (relative to the root node).


3D Viewer:

- Color mode "Downstream of tag" is now a shading mode.

- New synapse coloring mode "Same as skeleton". If you then hide the
  skeletons and show only the synapses you will e.g. see spatial tiling of ORN
  axons, each defining a glomerulus in the larval olfactory lobe.

- For PNG and SVG export one can now specify the dimensions of the result files.
  A dialog shown before exporting asks for width and height.


Neuron dendrogram:

- The horizontal and vertical spacing between nodes in the neuron dendrogram can
  now be fine tuned.


Administration:

- A new tool 'Group membership helper' has been added to add multiple users to
  multiple groups or to revoke their group membership. This can be used to
  control access over the data created by individual users.


Miscellaneous:

- A node-placement-and-radius-edit mode has been added. If enabled through the
  settings widget (Tracing > "Edit radius after node creation"), the radius for
  a node will be edited immediately after it has been created. This allows for
  easier volumetric reconstruction. In this mode, the radius circle editing tool
  is used to specify the radius. No dialog is shown once a radius is selected for
  a node and it will only be saved for the new node.

- A new connector type ("abutting") can now be created. In contrast to the
  regular synaptic connector, it can be used to represent the fact that two or
  more neurons are in abutting processes. For now this mode can be activated
  through the settings widget (Tracing > "Create abutting connectors"). For
  abutting connectors the lines representing the links to nodes will appear in a
  green color.


### Bug fixes

3D viewer:

- Adding and removing neurons and static data lead in some situations to many
  errors that were displayed on the console (and therefore not visible to most
  users) and caused minor performance problems. This has been fixed and all data
  should now be added and removed correctly.

- Following the active node should now work much more reliable. Before, it could
  happen that this stopped working after a second 3D viewer was closed.


Connectivity widget:

- Fix one cause of sluggish behavior for widgets that have been modified many
  times. Also fixes repeated alert dialogs when clicking a neuron in the
  partner tables that no longer exists or does not have any treenodes.


Neuron Navigator:

- Don't show an error if an invalid regular expression was entered for
  searching. Instead, color the search box red and show a warning message.


## 2015.3.31

Contributors: Albert Cardona, Andrew Champion, Tom Kazimiers, Stephan Gerhard

### Features and enhancements

Key shortcuts / mouse operations:

- Shift+T removes all tags from the currently active node.

- After using R to go the nearest open leaf, shift+R cycles through other open
  leaves in the skeleton in order of ascending distance from the starting
  location. Combining alt with these operations orders open leaves by most
  recent creation instead of distance.

- Ctrl+Y removes the active skeleton from the last used selection widget.

- Shift+Y selects skeletons within a radius of the active node in the tracing
  layer and adds them to the last used selection widget. Ctrl+shift+Y works in
  the same way to remove skeletons from the last used selection widget.

- If the next (or previous) branch/end point is already selected when V (or B)
  is pressed, the view will center on it nevertheless.

- If the mouse is over the stack when zooming, the view will recenter so that
  the same stack location remains under the mouse at the new scale.

- During review, Q and W during will refocus on the last reviewed neuron if
  review is interrupted (another node is selected), regardless of the auto
  centering setting. If one looks beyond the current segment, the last reviewed
  node will be selected by Q and W as well, but auto centering is respected.


Review system:

- New "Reviewer Team" system allows filtering reviews in visualizations and
  statistics to include only those by particular reviewers. Each user can
  control which reviewers to include in her team. A date can be configured for
  each reviewer in the team, so that only reviews from that reviewer after this
  date are included.
  * A user's reviewer team is configured through the Settings widget.
  * The review widget includes a team column between the user and union columns.
  * The percent reviewed column in the selection widget can be set to team or
    union.
  * Team review coloring is available in the 3D viewer and group graph.


3D viewer:

- With Ctrl + mouse wheel, only the camera is moved in target direction, the
  target stays fixed. If Alt + mouse wheel is used, the target moves as well.

- The CSV export not also includes the parent ID for each node, which can be
  used to reconstruct the topological tree.

- The auto-created selection widget is now 50% smaller, giving more vertical
  space to the 3D viewer.

- With the help of controls of the Animation tab, simple animations can be
  played. Currently, rotation around the X, Y and Z axis as well as the current
  "up" direction of the camera. is supported. The back-and-forth mode will
  reverse rotation direction once a full circle is reached. With the help of the
  stepwise visibility option, individual neurons can be made visible after a
  certain amount of time the animation is running. Additionally, neurons can be
  made sequentially visible after each rotation.

- Animations can also be exported as WebM movie file. The "Export animation"
  button in the Export tab, will show a dialog with basic export settings. Like
  with the other view export options, the current 3D view setup is used. The
  frame size can be adjusted in the export dialog. Creating the file can take
  some seconds and currently only works for the Chrome browser (due to the lack
  of WebP support in others). The resulting WebM video file can be converted to
  any other format using e.g. VLC player, if needed.

- New shading mode "synapse-free chunks". Has one parameter, the minimum amount
of synapse-free cable to consider between two consecutive synapses, adjustable
from the "Shading Parameters" tab.

- New shading mode "dendritic backbone". Depends on 'microtubules end' tags, or
will approximate twigs by using the Strahler number entered in the "Shading
Parameters" tab.

- The view settings tab now contains a control to scale the size of the node
  handles (e.g. active node, special tags).


Tile layer:

- Tiles can now be rendered with WebGL, which enables new visualization features
  and fixes some flickering issues. Enable via "Prefer WebGL Layers" in
  Settings. The WebGL renderer is currently considered experimental and may have
  stability issues on some clients. See
  https://github.com/catmaid/CATMAID/issues/186#issuecomment-86540706 for
  details on using WebGL layers with your image stack host.

- The blend mode used to combine stacks and overlays is now configurable when
  using WebGL. This greatly improves visualization of confocal and other
  multichannel data. Blend mode is selectable from the layers control, activated
  via the toggle at the bottom left of the stack view.

- Filters can be applied to layers when using WebGL. Filters can be added and
  removed from layers through the layers control. Available filters currently
  include:
  * Gaussian blur
  * Color inversion
  * Brightness, contrast and saturation adjustment
  * Color matrix transform


Connectivity widget:

- It is now possible to remove added neurons again. Each row of the table of
  target neurons now contains a small 'x' icon in the first column to remove it.

- The selection column is not included anymore in the CSV export.


Analyze Arbor:

- Options are provided to approximate twigs by using a branch Strahler number
defined in the "Options".

- Dimensions of the pie charts and XY plots is now configurable from the
"Options" dialog.


Graph widget:

- New button to "Clone" the graph widget: opens a new widget with identical content.

- New buttons to "Save" and "Open..." to/from JSON, so that complex graphs can be
reloaded later on. Skeletons not present in the database are not loaded.


Miscellaneous:

- Selecting tags for highlighting in the neuron dendrogram

- Synchronization between widgets was improved. Deleting a neuron in one widget,
  will remove it from other widgets as well.

- Hovering over the CATMAID text on the front page will display CATMAID's
  version.


Admin:

- For projects, stacks, overlays and data views there is now the option to
  duplicate objects from within the admin view. To copy objects without their
  relations, there is now a new action in the list view's action menu. To
  duplicate an entity with its relations, select the object and use the "save as
  new" button.


Export:

- A basic JSON export of all treenodes and connectors of the selected neurons is
  now possible.


### Bug fixes

Tracing overlay:

- Trying to remove a non-existent tag from a node now doesn't show an error
  dialog anymore, but only a notification.


Key shortcuts / mouse operations:

- Fix bug where tagged nodes were not considered open by R regardless of tag
  content.


Neuron search:

- Make neuron names wrap and use the next line, if there is not enough space for
  it. This makes the table not expand in width until the name fits anymore.


3D viewer:

- Picking a synapse or other selectable elements is now more robust and now
  works also in orthographic mode.

- The projection mode (orthographic or perspective) is now also stored in a
  saved view.

- The 3D viewer's drawing canvas is now correctly sized again. Since the tab
  panel has been introduced, the 3D viewer has been too high. Now the
  pre-defined views (XY, XZ, ZY, ZX) are display correctly again, i.e. the whole
  bounding box is now seen again.

- Performance enhancement when smoothing skeletons with a Gaussian by avoiding
to update the same Vector3 instances twice.


Reviews:

- Pressing 'E' during review will now go to the next unreviewed segment as seen
  from the currently reviewed one. Before, the first unreviewed segment as seen
  from the top of the table was selected.

- Pressing 'Q' on the first node (leaf) brings one back one section to check if
  the segment really ends. Pressing 'W' afterwards now brings one back to the
  first node, not the second like it has been before.


Connectivity widget:

- CSV export works again.


Miscellaneous:

- Vertical resizing of widgets now doesn't lead to strange size changes anymore.

- An alternative DVID tile source was added to support its multiscale API.


## 2015.1.21

Contributors: Albert Cardona, Andrew Champion, Tom Kazimiers

### Features and enhancements

General neuron tracing:

- A new radius editing option has been added that propagates from the current
  node root-ward to the previous node with an undefined radius (exclusive).
  Here undefined is taken to be a negative radius, since though the column
  default is 0 Django initializes it to -1.

Miscellaneous:

- Users need now to confirm the closing of the last stack.


### Bug fixes

Tracing overlay:

- A label is now hidden when the mouse hovers over it. Note that this only works
  for one label at a time, so it is not effective for overlapping labels. A
  robust solution would require more expensive event propagation over label
  elements.

- Fullscreen on OS X Safari should now work, too.

- Nodes and arrows are now drawn in order: lines, arrows, nodes, labels

- Fix bug that could occur during radius propagation when the previous node
  already had a radius defined.

- Fix mouse handlers of node and error drawing, which were broken by adding
  ordered drawing.


Synapse clustering:

- A long-standing error has been fixed where a few nodes where added to an
  undefined cluster.


Group graph:

- The root node computation has been fixed.

- Listing edge synapses now also works with split grouped neurons.


3D viewer:

- Make synapse clustering fetch synapses properly (like it is done in the Group
  Graph).


## 2015.1.15

Key shortcuts / mouse operations:

- A new shortcut key to navigate to a node's child has been added: ]. It
  behaves like V by navigating to the largest descendant branch. With
Shift+] one cycles through sibling branches in order of descending
size.

- For consistency, the P shortcut to navigate to the parent has been
replaced with [.

- Navigation to the next branch has changed a bit: The V key now moves
to the next branch node or end of the largest descendant branch of the
active node, and subsequent presses of shift+V cycle through other
possible descending branches in order of decreasing size.

- While editing the radius of a node with the help of the surrounding
circle, a click will confirm the current radius (not only pressing 'o'
again). The radius editing can now also be canceled with the Esc key.

- With Ctrl+Alt+click one can now insert a node into the active
skeleton between two existing nodes.


Zoom:

- Zooming is now also possible in smaller steps. The plus and minus
buttons zoom in steps of 1 and with having the Shift key pressed
additionally, steps of 0.1 are used.


3D viewer:

- New export options (Export tab):
  * CVS representation of the rendered skeletons;
  * PNG and SVG image of the current view;
  * SVG catalogue of the current view. The catalogue contains each
neuron a separate panel on the same SVG document--very useful to
generate figures for a paper. Options are provided to sort and arrange
panels, and to define pinned neurons that appear in each panel (e.g. a
somatosensory axon that acts as reference for each neuron connected to
it).

- New "Spatial select" button (Main tab) that allows to select
skeletons near the active node or connected to the active skeleton,
within a specified distance. Matching skeletons will be shown in a new
selection table. This is useful to e.g. select all single-node
skeletons connected to the dorsal lobe part of a Kenyon cell.

- Supports orthographic projection (see checkbox in View tab) so that
no perspective distortion is applied and distances become comparable
between different parts of the view.

- The 3D viewer now has the option to follow the active node (View
tab). This acts like clicking "Center active" after each active node
change.

- One can bookmark views in the 3D viewer, by pressing "Save view" in
the Main tab. Views can be loaded by selecting them from the drop down
list next to the button. These bookmarks are currently discarded once
CATMAID is reloaded.

- When Ctrl is pressed while zooming in the 3D viewer with the scroll
wheel, the camera is actually moved towards its target. This is useful
to overcome zooming limits and strong perspective distortion due to a
high focal length when zooming.


Selection table:

- "Randomize colors" in the selection table was replaced by a drop
down list with different color schemes and the button "Colorize" to
apply the selected one. The default is the coloring scheme that
existed before. Some of the new color schemes are from Cynthia Brewer
(see http://colorbrewer2.org/ ).

- Neurons are activated by clicking on the name, like in all other
widgets. The green tick icon has been removed.

- New check box for each neuron called "meta" to toggle the display of
extra information like the orange spheres for specially tagged nodes
(TODO, uncertain end, etc.) or low confidence nodes.


Dendrogram:

- Can now collapse nodes belonging to a branch that ends in a node
tagged "not a branch".

- One can now highlight multiple tags in the dendrogram by separating
them with commas.


Graph widget:

- Subgraphs (like axon & dendrite) can now be reset in the graph widget.


Annotations:

- When adding an annotation, the pattern "{nX}" can be used to add an
automatically incrementing number to each neuron annotated, starting
at X. So if e.g. three neurons are annotated at once with the
annotation "test-{n5}", the first one is annotated with "test-5", the
second one with "test-6" and the last one with "test-7". Omitting X
will be interpreted to start from 1.

- When skeletons are joined, the name of the "losing" skeleton can now
be added as an annotation to the "winning" skeleton right in the
dialog. Its checkbox is unchecked by default, if the name follows the
auto-generated name pattern "neuron 12345".


Searching:

- The neuron name input boxes in both search widgets will now remember
entries that have been used before.


Handling the unexpected:

- A general error handler has been added so that CATMAID should
hopefully not crash anymore, even if an error occurs. In such
situations an error dialog is shown and the error is logged on the
server so that we can investigate better what went wrong.


General neuron tracing:

- A robust synapse clustering method was added: centrifugal synapse flow
centrality. Many widgets now support a new method for finding axons based on it
(e.g. in the 3D viewer as a shading method.

- The connector table now displays the confidence of each link

- Basic import/export support was added. There are two new management commands
  that can be used by admins to import and export tracing data.


Users and groups:

- Support user registration (disabled by default). Default user groups for new
  users can be set.


Miscellaneous:

- A new ROI tool was added, which can be activated for each user through the
user settings. It currently supports only the creation of new ROIs. Additional
sub-tools will be added for more functionality.


Contributors:

This update brought to you by Tom Kazimiers, Andrew Champion, Stephan
Gerhard and Albert Cardona.
