from odoo import fields, models, api
import random


class RsLocationSeatAssignment(models.Model):
    _name = 'rs.location.seat.assignment'
    _description = 'Seat Assignment for a Location'
    _rec_name = 'user_id'

    location_id = fields.Many2one(
        'rs.location', string='Location', required=True, ondelete='cascade')
    user_id = fields.Many2one('res.users', string='User', required=True)
    position_x = fields.Float(
        string='Position X', required=True, default=lambda self: 15)
    position_y = fields.Float(string='Position Y', required=True,
                              default=lambda self: 100 + self._get_random_offset())
    avatar_size = fields.Float(
        string='Avatar Size', default=20.0, help='Size of the avatar in pixels')
