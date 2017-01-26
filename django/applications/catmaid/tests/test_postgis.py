from django.db import connection
from django.test import TestCase
from django.test.client import Client
from guardian.shortcuts import assign_perm
from catmaid.models import Project, User
from catmaid.control import node, skeleton, treenode

import json

class PostGISTests(TestCase):
    """
    Test PostGIS related functionality. It expects the 'postgis' extension to
    be available in the test database. At the moment, it seems, the easiest way
    to have this, is to create a Postgres template called 'template_postgis'
    which has this extension enabled:
    https://docs.djangoproject.com/en/dev/ref/contrib/gis/install/postgis/#creating-a-spatial-database-template-for-earlier-versions
    """
    fixtures = ['catmaid_testdata']

    def setUp(self):
        self.username = "test2"
        self.password = "test"
        self.user = User.objects.get(username=self.username)
        self.test_project_id = 3

        self.client = Client()
        self.client.login(username=self.username, password=self.password)

        # Make sure the test user has permissions to browse and annotate
        # projects
        p = Project.objects.get(pk=self.test_project_id)
        assign_perm('can_browse', self.user, p)
        assign_perm('can_annotate', self.user, p)

    def test_node_query(self):
        """
        Make sure nodes returned by a PostGIS based query are the same as the
        regular ones.
        """
        params = {
            'sid': 3,
            'limit': 5000,
            'project_id': self.test_project_id,
            'z1': 0,
            'z2': 9,
            'top': 4625.0,
            'left': 2860.0,
            'bottom': 8075.0,
            'right': 10860.0,
            'labels': False,
        }

        non_postgis_nodes_r = node.node_list_tuples_query(params,
                self.test_project_id, None, None, include_labels=False,
                node_provider=node.nodeProviders['classic'])

        postgis_3d_nodes_r = node.node_list_tuples_query(params,
                self.test_project_id, None, None, include_labels=False,
                node_provider=node.nodeProviders['postgis-3d'])

        postgis_2d_nodes_r = node.node_list_tuples_query(params,
                self.test_project_id, None, None, include_labels=False,
                node_provider=node.nodeProviders['postgis-2d'])

        self.assertEqual(non_postgis_nodes_r.status_code, 200)
        self.assertEqual(postgis_3d_nodes_r.status_code, 200)
        self.assertEqual(postgis_2d_nodes_r.status_code, 200)
        non_postgis_nodes = json.loads(non_postgis_nodes_r.content)
        postgis_3d_nodes = json.loads(postgis_3d_nodes_r.content)
        postgis_2d_nodes = json.loads(postgis_2d_nodes_r.content)

        for n in non_postgis_nodes[1]:
            n[5] = frozenset([tuple(l) for l in n[5]])
        for n in postgis_3d_nodes[1]:
            n[5] = frozenset([tuple(l) for l in n[5]])
        for n in postgis_2d_nodes[1]:
            n[5] = frozenset([tuple(l) for l in n[5]])

        def test_returned_nodes(reference, to_test):
            self.assertEqual(len(reference), len(to_test))
            self.assertEqual(len(reference[0]), len(to_test[0]))
            self.assertEqual(len(reference[1]), len(to_test[1]))
            self.assertEqual(len(reference[2]), len(to_test[2]))
            self.assertEqual(reference[3], to_test[3])

            for tn in reference[0]:
                self.assertTrue(tn in to_test[0])

            for tn in to_test[0]:
                self.assertTrue(tn in reference[0])

            for c in reference[1]:
                c[7] = sorted(c[7])

            for c in to_test[1]:
                c[7] = sorted(c[7])

            for c in reference[1]:
                self.assertTrue(c in to_test[1])

            for c in to_test[1]:
                self.assertTrue(c in reference[1])

        test_returned_nodes(non_postgis_nodes, postgis_3d_nodes)
        test_returned_nodes(non_postgis_nodes, postgis_2d_nodes)

    def get_edges(self, cursor, tnid):
        cursor.execute("""
            SELECT edge FROM treenode_edge WHERE id=%s AND project_id=%s
                    """,
            (tnid, self.test_project_id))
        return cursor.fetchall()

    def test_skeleton_join(self):
        """Test if joning two skeletons update the edge table correctly.
        """
        # Create two independent skeletons with one treenode each
        from_treenode = treenode._create_treenode(
            self.test_project_id, self.user, self.user, 0, 0, 0, -1, 0, -1, -1)
        to_treenode = treenode._create_treenode(
            self.test_project_id, self.user, self.user, 1, 1, 1, -1, 0, -1, -1)
        annotation_map = {}

        cursor = connection.cursor()

        # Expect one (self referencing) edge for both new nodes
        from_edges_before = self.get_edges(cursor, from_treenode.treenode_id)
        to_edges_before = self.get_edges(cursor, to_treenode.treenode_id)
        self.assertEqual(1, len(from_edges_before))
        self.assertEqual(1, len(to_edges_before))

        # Join them and test if the correct node appears in the edge table
        skeleton._join_skeleton(self.user,
                                from_treenode.treenode_id,
                                to_treenode.treenode_id,
                                self.test_project_id,
                                annotation_map)

        # Expect still one edge per node, but expect the to_edge to be
        # different from before (because it now references from_node)
        from_edges_after = self.get_edges(cursor, from_treenode.treenode_id)
        to_edges_after = self.get_edges(cursor, to_treenode.treenode_id)
        self.assertEqual(1, len(from_edges_after))
        self.assertEqual(1, len(to_edges_after))
        self.assertEqual(from_edges_before[0], from_edges_after[0])
        self.assertNotEqual(to_edges_before[0], to_edges_after[0])
