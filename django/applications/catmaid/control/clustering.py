import sys
import json
import string

from django import forms
from django.forms.widgets import CheckboxSelectMultiple
from django.shortcuts import render_to_response
from django.contrib.formtools.wizard.views import SessionWizardView
from django.http import HttpResponse
from django.template import RequestContext

from catmaid.models import Class, ClassInstance, ClassClass, ClassInstanceClassInstance
from catmaid.control.classification import ClassProxy
from catmaid.control.classification import get_root_classes_qs, get_classification_links_qs

import numpy, scipy
import scipy.cluster.hierarchy as hier
import scipy.spatial.distance as dist

metrics = (
    ('jaccard', 'Jaccard'),
    ('hamming', 'Hamming'),
    ('chebyshev', 'Chebyshev'),
)

linkages = (
    ('single', 'Single (nearest point algorithm)'),
    ('complete', 'Complete (farthest point algorithm)'),
    ('average', 'Average (UPGMA)'),
    ('weighted', 'Weighted'),
    ('centroid', 'Centroid'),
    ('median', 'Median'),
    ('ward', 'Ward'),
)

class ClassInstanceProxy(ClassInstance):
    """ A proxy class to allow custom labeling of class instances in
    model forms.
    """
    class Meta:
        proxy=True

    def __unicode__(self):
        return "{0} ({1})".format(self.name, str(self.id))

def create_ontology_selection_form( workspace_pid, class_ids=None ):
    """ Creates a new SelectOntologyForm class with an up-to-date
    class queryset.
    """
    if not class_ids:
        class_ids = get_root_classes_qs(workspace_pid)

    class SelectOntologyForm(forms.Form):
        """ A simple form to select classification ontologies. A choice
        field allows to select a single class that 'is_a' 'classification_root'.
        """
        ontologies = forms.ModelMultipleChoiceField(
            queryset=Class.objects.filter(id__in=class_ids),
            widget=CheckboxSelectMultiple())
        add_nonleafs = forms.BooleanField(initial=False,
            required=False, label="Use sub-paths as features")

    return SelectOntologyForm

class ClusteringSetupGraphs(forms.Form):
    classification_graphs = forms.ModelMultipleChoiceField(
        queryset=ClassInstanceProxy.objects.all(),
        widget=CheckboxSelectMultiple())

class ClusteringSetupMath(forms.Form):
    metric = forms.ChoiceField(choices=metrics)
    linkage = forms.ChoiceField(choices=linkages)

class ClusteringWizard(SessionWizardView):
    template_name = "catmaid/clustering/setup.html"
    workspace_pid = None

    def get_form(self, step=None, data=None, files=None):
        form = super(ClusteringWizard, self).get_form(step, data, files)
        current_step = step or self.steps.current
        if current_step == 'classifications':
            # Select root nodes of graphs that are instances of the
            # selected ontologies
            ontologies = self.get_cleaned_data_for_step('ontologies')['ontologies']
            root_ci_qs = ClassInstanceProxy.objects.filter( class_column__in=ontologies )
            form.fields['classification_graphs'].queryset = root_ci_qs

        return form

    def get_context_data(self, form, **kwargs):
        context = super(ClusteringWizard, self).get_context_data(form=form, **kwargs)
        if self.steps.current == 'ontologies':
            desc = 'Please select all the ontologies that you want to see ' \
                   'considered for feature selection. Additionally, you can ' \
                   'define whether all sub-paths starting from root to a ' \
                   'leaf should be used as features, too.'
        elif self.steps.current == 'classifications':
            desc = 'Below are all classification graphs shown, that are based ' \
                   'on the previeously selected ontologies. Please select those ' \
                   'you want to be considered in the clustering.'
        else:
            desc = "Please adjust the clustering settings to your liking."

        context.update({
            'description': desc,
            'workspace_pid': self.workspace_pid})

        return context

    def done(self, form_list, **kwargs):
        cleaned_data = [form.cleaned_data for form in form_list]
        ontologies = cleaned_data[0].get('ontologies')
        add_nonleafs = cleaned_data[0].get('add_nonleafs')
        graphs = cleaned_data[1].get('classification_graphs')
        metric = str(cleaned_data[2].get('metric'))
        linkage = str(cleaned_data[2].get('linkage'))

        # Featurs are abstract concepts (classes) and graphs will be
        # checked which classes they have instanciated.
        features = []
        # TODO: Only consider features that are instantiated
        for o in ontologies:
            features = features + get_features( o, add_nonleafs )

        bin_matrix = numpy.array(create_binary_matrix(graphs, features))
        # Calculate the distance matrix
        dst_matrix = dist.pdist(bin_matrix, metric)
        # The distance matrix now has no redundancies, but we need the square form
        dst_matrix = dist.squareform(dst_matrix)
        # Calculate linkage matrix
        linkage_matrix = hier.linkage(bin_matrix, linkage, metric)
        # Obtain the clustering dendrogram data
        graph_names = [ g.name for g in graphs ]
        dendrogram = hier.dendrogram(linkage_matrix, no_plot=True,
            count_sort=True, labels=graph_names)

        # Create a binary_matrix with graphs attached for display
        num_graphs = len(graphs)
        display_bin_matrix = []
        for i in range( num_graphs ):
            display_bin_matrix.append(
                {'graph': graphs[i], 'feature': bin_matrix[i]})

        # Create dst_matrix with graphs attached
        display_dst_matrix = []
        for i in range(num_graphs):
            display_dst_matrix.append(
                {'graph': graphs[i], 'distances': dst_matrix[i]})

        # Create a JSON version of the dendrogram to make it
        # available to the client.
        dendrogram_json = json.dumps(dendrogram)

        # Get the default request context and add custom data
        context = RequestContext(self.request)
        context.update({
            'ontologies': ontologies,
            'graphs': graphs,
            'features': features,
            'bin_matrix': display_bin_matrix,
            'metric': metric,
            'dst_matrix': display_dst_matrix,
            'dendrogram_json': dendrogram_json})

        return render_to_response('catmaid/clustering/display.html', context)

class FeatureLink:
    def __init__(self, class_a, class_b, relation, super_class = None):
        self.class_a = class_a
        self.class_b = class_b
        self.relation = relation
        self.super_class = super_class

class Feature:
    """ A small container to keep a list of class-class links.
    """
    def __init__(self, class_class_links):
        self.links = class_class_links
        self.name = ",".join(
            [l.class_a.class_name for l in self.links] )
    def __str__(self):
        return self.name
    def __len__(self):
        return len(self.links)

def get_features( ontology, add_nonleafs=False ):
    """ Return a list of Feature instances which represent paths
    to leafs of the ontology.
    """
    feature_lists = get_feature_paths( ontology, add_nonleafs )
    return [ Feature(fl) for fl in feature_lists ]

def get_feature_paths( ontology, add_nonleafs=False, depth=0, max_depth=100 ):
    """ Returns all root-leaf paths of the passed ontology. It respects
    is_a relationships.
    """
    features = []
    # Get all links, but exclude 'is_a' relationships
    links_q = ClassClass.objects.filter(class_b_id=ontology.id).exclude(
        relation__relation_name='is_a')
    # Check if this link is followed by an 'is_a' relatiship. If so
    # use the classes below.
    feature_links = []
    for link in links_q:
        is_a_links_q = ClassClass.objects.filter(class_b_id=link.class_a.id,
            relation__relation_name='is_a')
        # Add all sub-classes instead of the root if there is at least one.
        if is_a_links_q.count() > 0:
            for is_a_link in is_a_links_q:
                fl = FeatureLink(is_a_link.class_a, link.class_b, link.relation, link.class_a)
                feature_links.append(fl)
        else:
            fl = FeatureLink(link.class_a, link.class_b, link.relation)
            feature_links.append(fl)

    # Look at the feature link paths
    for flink in feature_links:
        add_single_link = False

        if depth < max_depth:
            child = flink.super_class if flink.super_class else flink.class_a
            child_features = get_feature_paths( child, add_nonleafs, depth+1 )
            # Remember the path to this node as feature if a leaf is reached
            # or if non-leaf nodes should be added, too.
            is_leaf = (len(child_features) == 0)
            add_single_link = is_leaf or add_nonleafs
            for cf in child_features:
                features.append( [flink] + cf )
        else:
            # Add current node if we reached the maximum depth
            # and don't recurse any further.
            add_single_link = True

        # Add single link if no more children are found/wanted
        if add_single_link:
            features.append( [flink] )

    return features

def setup_clustering(request, workspace_pid=None):
    workspace_pid = int(workspace_pid)
    select_ontology_form = create_ontology_selection_form(workspace_pid)
    forms = [('ontologies', select_ontology_form),
             ('classifications', ClusteringSetupGraphs),
             ('clustering', ClusteringSetupMath)]
    view = ClusteringWizard.as_view(forms, workspace_pid=workspace_pid)
    return view(request)

def graph_instances_feature(graph, feature, idx=0):
    """ Traverses a class instance graph, starting from the passed node.
    It recurses into child graphs and tests on every class instance if it
    is linked to an ontology node. If it does, the function returns true.
    """
    # An empty feature is always true
    num_features = len(feature)
    if num_features == idx:
        return True
    f_head = feature.links[idx]

    # Check for a link to the first feature component
    link_q = ClassInstanceClassInstance.objects.filter(
        class_instance_b=graph, class_instance_a__class_column=f_head.class_a,
        relation=f_head.relation)
    num_links = link_q.count()
    # Make sure there is the expected child link
    if num_links == 0:
        return False
    elif num_links > 1:
        # More than one?
        raise Exception('Found more than one ontology node link of one class instance.')

    # Continue with checking children, if any
    return graph_instances_feature(link_q[0].class_instance_a, feature, idx+1)

def create_binary_matrix(graphs, features):
    """ Creates a binary matrix for the graphs passed."""
    num_features = len(features)
    num_graphs = len(graphs)
    # Fill matrix with zeros
    matrix = [ [ 0 for j in range(num_features)] for i in range(num_graphs) ]
    # Put a one at each position where the tree has
    # a feature defined
    for i in range(num_graphs):
        graph = graphs[i]
        for j in range(num_features):
            feature = features[j]
            # Check if a feature (root-leaf path in graph) is part of the
            # current graph
            if graph_instances_feature(graph, feature):
                matrix[i][j] = 1

    return matrix

