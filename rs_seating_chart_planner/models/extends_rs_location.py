from odoo import fields, models, api

class ExtendsRsLocation(models.Model):
    _inherit = 'rs.location'

    svg_image = fields.Binary(string='SVG File')
    seat_assignments = fields.One2many('rs.location.seat.assignment', 'location_id', string='Seat Assignments')

    def action_add_multiple_users(self):
        """Open a wizard to add multiple users as seat assignments"""
        return {
            'name': 'Add Multiple Users',
            'type': 'ir.actions.act_window',
            'view_mode': 'form',
            'res_model': 'rs.location.add.users.wizard',
            'target': 'new',
            'context': {
                'default_location_id': self.id,
            }
        }
