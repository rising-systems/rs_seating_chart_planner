from odoo import fields, models

class Location(models.Model):
    _name = 'rs.location'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _description = 'RS Location'

    name = fields.Char(string='Name', required=True)
    parent_id = fields.Many2one(
        'rs.location',
        string='Parents'
    )
    child_ids = fields.One2many(
        'rs.location',
        'parent_id',
        string='Children'
    )