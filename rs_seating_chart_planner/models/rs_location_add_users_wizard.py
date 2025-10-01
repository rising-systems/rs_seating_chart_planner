from odoo import fields, models, api

class RsLocationAddUsersWizard(models.TransientModel):
    _name = 'rs.location.add.users.wizard'
    _description = 'Wizard to add multiple users to location seat assignments'

    location_id = fields.Many2one('rs.location', string='Location', required=True)
    user_ids = fields.Many2many('res.users', string='Users to Add', required=True, help='Select multiple users to add as seat assignments')

    def action_add_users(self):
        """Add selected users as seat assignments to the location"""
        if not self.user_ids:
            return

        # Get existing assigned users to avoid duplicates
        existing_user_ids = self.location_id.seat_assignments.mapped('user_id.id')

        # Create seat assignments for new users only
        new_assignments = []
        for user in self.user_ids:
            if user.id not in existing_user_ids:
                new_assignments.append({
                    'user_id': user.id,
                    'location_id': self.location_id.id,
                    'position_x': 0,  # Default position
                    'position_y': 0,  # Default position
                })

        if new_assignments:
            self.env['rs.location.seat.assignment'].create(new_assignments)

        return {'type': 'ir.actions.act_window_close'}
