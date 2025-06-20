from odoo.tests.common import TransactionCase
from odoo.tools import mute_logger
import psycopg2

class TestRsLocation(TransactionCase):
    def setUp(self):
        """Set up initial data for the tests"""
        super(TestRsLocation, self).setUp()

        # Create test locations
        self.location_model = self.env['rs.location']

        # Create a parent location
        self.parent_location = self.location_model.create({
            'name': 'Parent Location',
        })

        # Create a child location
        self.child_location = self.location_model.create({
            'name': 'Child Location',
            'parent_id': self.parent_location.id,
        })

    def test_create_location(self):
        """Test creating a new location"""
        location = self.location_model.create({
            'name': 'Test Location',
        })
        self.assertTrue(location.id, "Location should be created with an ID")
        self.assertEqual(location.name, 'Test Location', "Location name should match")

    def test_required_name(self):
        """Test that name field is required"""
        with self.assertRaises(psycopg2.errors.NotNullViolation):
            with mute_logger('odoo.sql_db'):
                self.location_model.create({
                    # No name provided
                })

    def test_parent_child_relationship(self):
        """Test the parent-child relationship between locations"""
        self.assertIn(
            self.child_location.id,
            self.parent_location.child_ids.ids,
            "Parent should have child in child_ids"
        )
        self.assertEqual(
            self.child_location.parent_id.id,
            self.parent_location.id,
            "Child should have correct parent"
        )
