from odoo import fields, models, api


class ExtendsRsLocation(models.Model):
    _inherit = 'rs.location'

    svg_image = fields.Binary(string='SVG File')
    seat_assignments = fields.One2many(
        'rs.location.seat.assignment', 'location_id', string='Seat Assignments')
