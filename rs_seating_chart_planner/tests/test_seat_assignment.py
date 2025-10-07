from odoo.tests.common import TransactionCase

class TestRsLocationSeatAssignment(TransactionCase):

    def setUp(self):
        super().setUp()

        self.location = self.env['rs.location'].create({
            'name': 'Test Room'
        })

        # Dummy user anlegen (res.users braucht mindestens login & Gruppen)
        self.user = self.env['res.users'].create({
            'name': 'Test User',
            'login': 'test_user@test.rs.ag',
            'email': 'test_user@test.rs.ag',
        })

    def test_create_seat_assignment(self):
        assignment = self.env['rs.location.seat.assignment'].create({
            'location_id': self.location.id,
            'user_id': self.user.id,
        })

        # position_x sollte Standardwert 15 sein
        self.assertEqual(assignment.position_x, 15.0)

        # position_y sollte im Bereich 110–200 liegen (wegen random offset 10–100)
        self.assertGreaterEqual(assignment.position_y, 110.0)
        self.assertLessEqual(assignment.position_y, 200.0)

        # Verknüpfungen prüfen
        self.assertEqual(assignment.location_id.name, 'Test Room')
        self.assertEqual(assignment.user_id.login, 'test_user@test.rs.ag')
