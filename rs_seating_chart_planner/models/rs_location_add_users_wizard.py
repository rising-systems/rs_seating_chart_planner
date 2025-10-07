from odoo import fields, models, api

class RsLocationAddUsersWizard(models.TransientModel):
    _name = 'rs.location.add.users.wizard'
    _description = 'Wizard to add multiple users to location seat assignments'

    location_id = fields.Many2one('rs.location', string='Location', required=True)
    user_ids = fields.Many2many('res.users', string='Users to Add', required=True, help='Select multiple users to add as seat assignments')
    available_user_ids = fields.Many2many('res.users', string='Available Users', compute='_compute_available_users', store=False)

    @api.depends('location_id')
    def _compute_available_users(self):
        """Compute available users excluding those already assigned to this location"""
        for wizard in self:
            if wizard.location_id:
                # Get users already assigned to this location
                assigned_user_ids = wizard.location_id.seat_assignments.mapped('user_id.id')

                # Get all users except the already assigned ones
                available_users = self.env['res.users'].search([
                    ('id', 'not in', assigned_user_ids),
                    ('share', '=', False)  # Only internal users
                ])
                wizard.available_user_ids = available_users
            else:
                wizard.available_user_ids = self.env['res.users']

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
