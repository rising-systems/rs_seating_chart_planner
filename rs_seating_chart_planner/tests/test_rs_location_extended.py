from odoo.tests.common import TransactionCase
from odoo import Command
import base64

class TestExtendedRsLocation(TransactionCase):

    def setUp(self):
        super().setUp()

        # Dummy User (res.users benötigt mindestens Login und Gruppen)
        self.user = self.env['res.users'].create({
            'name': 'Seat User',
            'login': 'seat.user@test.rs.ag',
            'email': 'seat.user@test.rs.ag',
            'groups_id': [Command.link([self.env.ref('base.group_user').id])],
        })

        # Dummy SVG-Inhalt
        self.svg_data = base64.b64encode(b"<svg><circle cx='50' cy='50' r='40'/></svg>")

        # Location mit SVG-Datei anlegen
        self.location = self.env['rs.location'].create({
            'name': 'SVG Room',
            'svg_image': self.svg_data,
        })

    def test_svg_and_seat_assignment(self):
        # Prüfen, ob SVG korrekt gespeichert wurde
        self.assertEqual(self.location.svg_image, self.svg_data)

        # Einen Sitzplatz zuweisen
        assignment = self.env['rs.location.seat.assignment'].create({
            'location_id': self.location.id,
            'user_id': self.user.id,
        })

        # Prüfen, ob der Sitzplatz in den One2many-Feldern auftaucht
        self.assertIn(assignment, self.location.seat_assignments)
        self.assertEqual(len(self.location.seat_assignments), 1)
        self.assertEqual(self.location.seat_assignments[0].user_id.login, 'seat.user@test.rs.ag')
